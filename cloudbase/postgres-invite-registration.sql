-- Dividend Tracker · CloudBase PostgreSQL invitation registration
-- Run as the environment database administrator after replacing the seed
-- placeholders. The live environment was migrated from this same script.

CREATE TABLE IF NOT EXISTS public.dividend_invites (
  code_hash text PRIMARY KEY,
  label text NOT NULL DEFAULT 'default',
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dividend_members (
  user_id text PRIMARY KEY,
  invite_code_hash text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dividend_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dividend_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dividend_invites FROM anon, authenticated;
GRANT SELECT, INSERT ON public.dividend_members TO authenticated;

DROP POLICY IF EXISTS dividend_members_self_read ON public.dividend_members;
CREATE POLICY dividend_members_self_read
  ON public.dividend_members FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS dividend_members_self_join ON public.dividend_members;
CREATE POLICY dividend_members_self_join
  ON public.dividend_members FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.validate_dividend_invite_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- CLI/service-role maintenance has no end-user uid and is allowed to seed
  -- existing accounts. Browser registration always carries an authenticated uid.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'invite owner mismatch' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.dividend_invites AS invite
    WHERE invite.code_hash = md5(NEW.invite_code_hash)
      AND invite.active
      AND (invite.expires_at IS NULL OR invite.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'invite invalid' USING ERRCODE = '42501';
  END IF;
  NEW.invite_code_hash := md5(NEW.invite_code_hash);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_dividend_invite_before_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS validate_dividend_invite ON public.dividend_members;
CREATE TRIGGER validate_dividend_invite
  BEFORE INSERT ON public.dividend_members
  FOR EACH ROW EXECUTE FUNCTION public.validate_dividend_invite_before_insert();

CREATE OR REPLACE FUNCTION public.is_dividend_member(candidate_uid text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dividend_members WHERE user_id = candidate_uid
  );
$$;

REVOKE ALL ON FUNCTION public.is_dividend_member(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_dividend_member(text) TO authenticated;

DROP POLICY IF EXISTS user_ledgers_owner ON public.user_ledgers;
CREATE POLICY user_ledgers_owner
  ON public.user_ledgers FOR ALL TO authenticated
  USING (auth.uid() = user_id AND public.is_dividend_member(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.is_dividend_member(auth.uid()));

-- Deployment-specific seed examples:
-- INSERT INTO public.dividend_invites(code_hash, label)
-- VALUES (md5('<high-entropy-invite-code>'), 'personal invite');
-- INSERT INTO public.dividend_members(user_id, invite_code_hash)
-- VALUES ('<existing-user-uid>', 'existing-account') ON CONFLICT DO NOTHING;

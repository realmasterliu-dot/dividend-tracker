import { describe, expect, it } from 'vitest';
import type {
  AppSettings,
  DividendEvent,
  Instrument,
  InvestmentPlan,
  Notification,
  Transaction,
} from '@/types';
import type { LedgerPayload } from '../types';
import {
  canonicalLedgerJson,
  canonicalizeLedgerPayload,
  createLedgerOwnerCache,
  createSyncOutbox,
  decideHydration,
  ledgerFingerprint,
  mergeLedgerPayloads,
  mergeLedgerPayloadsThreeWay,
  parseLedgerPayload,
  parseLedgerOwnerCache,
  parseSyncOutbox,
} from '../sync';

const settings: AppSettings = {
  baseCurrency: 'CNY',
  displayCurrency: 'CNY',
  colorScheme: 'CN',
  w8benFilled: false,
  fxNeutralMode: false,
  notificationChannels: {},
  stalenessThresholdHours: 48,
};

const instrument = (id: string, name = id): Instrument => ({
  id,
  symbol: id,
  name,
  market: 'A_SHARE',
  currency: 'CNY',
  dividendEligible: true,
  securityType: 'COMMON',
  extraWithholdingRate: 0,
  custodyChannel: 'CN_BROKER',
});

const transaction = (id: string, instrumentId = 'a', amount = 10): Transaction => ({
  id,
  instrumentId,
  type: 'BUY',
  status: 'CONFIRMED',
  date: '2026-08-12',
  quantity: 1,
  price: amount,
  amount,
  currency: 'CNY',
  fxRate: 1,
  source: 'MANUAL',
});

const plan = (id: string): InvestmentPlan => ({
  id,
  instrumentId: 'a',
  amount: 100,
  frequency: 'MONTHLY',
  executionDay: 12,
  startDate: '2026-08-12',
  holidayPolicy: 'NEXT_TRADING_DAY',
  monthEndPolicy: 'LAST_TRADING_DAY',
  autoConfirm: false,
  status: 'ACTIVE',
});

const dividend = (id: string): DividendEvent => ({
  id,
  instrumentId: 'a',
  status: 'PAID',
  payDate: '2026-08-12',
  payDateEstimated: false,
  perShareAmount: 1,
  currency: 'CNY',
  quantityAtRecord: 10,
  grossAmount: 10,
  taxRateApplied: 0,
  taxWithheld: 0,
  contingentTax: 0,
  netAmount: 10,
  taxBracket: 'NONE',
  dividendForm: 'CASH',
  manual: true,
  sourceKey: id,
});

const notification = (
  key: string,
  read: boolean,
  title = key,
  createdAt = '2026-08-12T00:00:00.000Z',
): Notification => ({
  id: `n-${key}`,
  key,
  type: 'PAY_DATE',
  title,
  body: title,
  severity: 'INFO',
  createdAt,
  read,
});

const payload = (overrides: Partial<LedgerPayload> = {}): LedgerPayload => ({
  schemaVersion: 1,
  instruments: [],
  transactions: [],
  plans: [],
  dividends: [],
  notifications: [],
  settings,
  updatedAt: '2026-08-12T00:00:00.000Z',
  ...overrides,
});

describe('parseLedgerPayload', () => {
  it('parses a valid object and JSON string', () => {
    const complete = payload({
      instruments: [instrument('a')],
      transactions: [transaction('t')],
      plans: [plan('p')],
      dividends: [dividend('d')],
      notifications: [notification('k', true)],
    });
    expect(parseLedgerPayload(complete)).toEqual({ ok: true, value: complete });
    expect(parseLedgerPayload(JSON.stringify(complete))).toEqual({ ok: true, value: complete });
  });

  it('rejects old and unknown schema versions without throwing', () => {
    for (const schemaVersion of [undefined, 0, 2, '1']) {
      const candidate = { ...payload(), schemaVersion };
      expect(() => parseLedgerPayload(candidate)).not.toThrow();
      const result = parseLedgerPayload(candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.join(' ')).toContain('unsupported schema');
    }
  });

  it('rejects malformed JSON, null, arrays, and unknown outer fields', () => {
    expect(parseLedgerPayload('{')).toEqual({ ok: false, issues: ['input: invalid JSON'] });
    expect(parseLedgerPayload(null).ok).toBe(false);
    expect(parseLedgerPayload([]).ok).toBe(false);
    const result = parseLedgerPayload({ ...payload(), injected: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContain('payload.injected: unknown field');
  });

  it('rejects corrupt collection types, enum values, invalid dates, and non-finite numbers', () => {
    const corrupt = {
      ...payload(),
      instruments: 'not-an-array',
      transactions: [{ ...transaction('t'), type: 'HACK', amount: Number.NaN }],
      plans: [{ ...plan('p'), startDate: '2026-02-30' }],
      notifications: [{ ...notification('k', false), read: 'yes' }],
    };
    const result = parseLedgerPayload(corrupt);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join('\n')).toContain('payload.instruments: must be an array');
      expect(result.issues.join('\n')).toContain('payload.transactions[0].type: unsupported value');
      expect(result.issues.join('\n')).toContain('finite JSON number');
      expect(result.issues.join('\n')).toContain('valid YYYY-MM-DD');
      expect(result.issues.join('\n')).toContain('payload.notifications[0].read: must be a boolean');
    }
  });

  it('rejects duplicate entity IDs and duplicate notification semantic keys', () => {
    const result = parseLedgerPayload(payload({
      instruments: [instrument('a'), instrument('a')],
      notifications: [notification('same', false), { ...notification('same', true), id: 'n-2' }],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join('\n')).toContain('duplicate key "a"');
      expect(result.issues.join('\n')).toContain('duplicate key "same"');
    }
  });

  it('rejects cyclic and executable values instead of serializing them partially', () => {
    const cyclic = payload() as LedgerPayload & { self?: unknown };
    cyclic.self = cyclic;
    expect(parseLedgerPayload(cyclic).ok).toBe(false);
    expect(parseLedgerPayload({ ...payload(), updatedAt: () => 'now' }).ok).toBe(false);
  });
});

describe('canonical ledger fingerprint', () => {
  it('is stable across array order, object key order, and updatedAt-only changes', () => {
    const first = payload({
      instruments: [instrument('b'), instrument('a')],
      transactions: [transaction('t2'), transaction('t1')],
      updatedAt: '2026-08-12T01:00:00.000Z',
    });
    const second = payload({
      instruments: [instrument('a'), instrument('b')],
      transactions: [transaction('t1'), transaction('t2')],
      settings: {
        stalenessThresholdHours: 48,
        notificationChannels: {},
        fxNeutralMode: false,
        w8benFilled: false,
        colorScheme: 'CN',
        displayCurrency: 'CNY',
        baseCurrency: 'CNY',
      },
      updatedAt: '2026-08-13T01:00:00.000Z',
    });
    expect(canonicalLedgerJson(first)).toBe(canonicalLedgerJson(second));
    expect(ledgerFingerprint(first)).toBe(ledgerFingerprint(second));
  });

  it('treats generated notification content and read state as ephemeral', () => {
    const first = payload({
      notifications: [{ ...notification('pay:a', false, 'old copy'), id: 'gen-pay-a' }],
    });
    const regenerated = payload({
      notifications: [
        { ...notification('pay:a', false, 'new copy'), id: 'gen-pay-a' },
        { ...notification('pay:b', false), id: 'gen-pay-b' },
      ],
    });
    const read = payload({
      notifications: [{ ...notification('pay:a', true, 'new copy'), id: 'gen-pay-a' }],
    });
    expect(ledgerFingerprint(first)).toBe(ledgerFingerprint(regenerated));
    expect(ledgerFingerprint(first)).toBe(ledgerFingerprint(read));
  });

  it('tracks durable notification creation, content and read state', () => {
    const empty = payload();
    const unread = payload({ notifications: [notification('manual:a', false, 'first')] });
    const edited = payload({ notifications: [notification('manual:a', false, 'edited')] });
    const read = payload({ notifications: [notification('manual:a', true, 'edited')] });
    expect(ledgerFingerprint(empty)).not.toBe(ledgerFingerprint(unread));
    expect(ledgerFingerprint(unread)).not.toBe(ledgerFingerprint(edited));
    expect(ledgerFingerprint(edited)).not.toBe(ledgerFingerprint(read));
  });

  it('ignores stale read state for generated notifications that are rebuilt from market data', () => {
    const generated = { ...notification('pay:expired', true), id: 'gen-pay-expired' };
    expect(ledgerFingerprint(payload({ notifications: [generated] }))).toBe(
      ledgerFingerprint(payload()),
    );
  });

  it('does not mutate the source while returning deterministic sorted collections', () => {
    const source = payload({ instruments: [instrument('b'), instrument('a')] });
    const canonical = canonicalizeLedgerPayload(source);
    expect(canonical.instruments.map((item) => item.id)).toEqual(['a', 'b']);
    expect(source.instruments.map((item) => item.id)).toEqual(['b', 'a']);
  });
});

describe('mergeLedgerPayloads', () => {
  it('keeps additions from both devices and sorts the union', () => {
    const local = payload({
      instruments: [instrument('local')],
      transactions: [transaction('t-local', 'local')],
    });
    const remote = payload({
      instruments: [instrument('remote')],
      transactions: [transaction('t-remote', 'remote')],
    });
    const result = mergeLedgerPayloads(local, remote);
    expect(result.payload.instruments.map((item) => item.id)).toEqual(['local', 'remote']);
    expect(result.payload.transactions.map((item) => item.id)).toEqual(['t-local', 't-remote']);
    expect(result.conflicts).toEqual([]);
  });

  it('uses revision before timestamp for same-ID conflicts and reports them', () => {
    const local = payload({
      instruments: [instrument('a', 'local edit')],
      updatedAt: '2026-08-10T00:00:00.000Z',
    });
    const remote = payload({
      instruments: [instrument('a', 'remote edit')],
      updatedAt: '2026-08-12T00:00:00.000Z',
    });
    const result = mergeLedgerPayloads(local, remote, { localRevision: 4, remoteRevision: 3 });
    expect(result.winner).toBe('local');
    expect(result.payload.instruments[0].name).toBe('local edit');
    expect(result.conflicts).toContainEqual({ slice: 'instruments', key: 'a', winner: 'local' });
  });

  it('uses newer payload timestamp, then explicit preference, for equal revisions', () => {
    const local = payload({ transactions: [transaction('t', 'a', 10)] });
    const newerRemote = payload({
      transactions: [transaction('t', 'a', 20)],
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    expect(mergeLedgerPayloads(local, newerRemote).payload.transactions[0].amount).toBe(20);

    const sameTimeRemote = payload({ transactions: [transaction('t', 'a', 30)] });
    expect(mergeLedgerPayloads(local, sameTimeRemote, { prefer: 'local' }).payload.transactions[0].amount).toBe(10);
  });

  it('uses the same LWW strategy for settings and exposes a settings conflict', () => {
    const local = payload({ settings: { ...settings, displayCurrency: 'USD' } });
    const remote = payload({
      settings: { ...settings, displayCurrency: 'HKD' },
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    const result = mergeLedgerPayloads(local, remote);
    expect(result.payload.settings.displayCurrency).toBe('HKD');
    expect(result.conflicts).toContainEqual({ slice: 'settings', key: 'settings', winner: 'remote' });
  });

  it('never loses a notification read flag during a content conflict', () => {
    const local = payload({ notifications: [notification('k', true, 'local')] });
    const remote = payload({
      notifications: [notification('k', false, 'remote', '2026-08-13T00:00:00.000Z')],
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    const result = mergeLedgerPayloads(local, remote);
    expect(result.payload.notifications).toHaveLength(1);
    expect(result.payload.notifications[0]).toMatchObject({ key: 'k', title: 'remote', read: true });
  });

  it('documents current deletion semantics by retaining an ID absent on one device', () => {
    const local = payload({ instruments: [] });
    const remote = payload({ instruments: [instrument('would-be-deleted')] });
    expect(mergeLedgerPayloads(local, remote).payload.instruments).toHaveLength(1);
  });
});

describe('mergeLedgerPayloadsThreeWay', () => {
  it('preserves a local deletion while retaining an independent remote addition', () => {
    const base = payload({ transactions: [transaction('remove-me')] });
    const local = payload({ transactions: [] });
    const remote = payload({
      transactions: [transaction('remove-me'), transaction('remote-addition')],
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    expect(mergeLedgerPayloadsThreeWay(base, local, remote).payload.transactions.map((item) => item.id))
      .toEqual(['remote-addition']);
  });

  it('uses delete-wins and reports a delete-vs-edit conflict', () => {
    const base = payload({ transactions: [transaction('t', 'a', 10)] });
    const local = payload({ transactions: [] });
    const remote = payload({ transactions: [transaction('t', 'a', 20)] });
    const result = mergeLedgerPayloadsThreeWay(base, local, remote);
    expect(result.payload.transactions).toEqual([]);
    expect(result.conflicts).toContainEqual({ slice: 'transactions', key: 't', winner: 'local' });
  });

  it('retains independent additions made on both devices', () => {
    const base = payload();
    const local = payload({ instruments: [instrument('local')] });
    const remote = payload({ instruments: [instrument('remote')] });
    expect(mergeLedgerPayloadsThreeWay(base, local, remote).payload.instruments.map((item) => item.id))
      .toEqual(['local', 'remote']);
  });

  it('uses revisions ahead of timestamps for same-ID concurrent edits', () => {
    const base = payload({ transactions: [transaction('t', 'a', 5)] });
    const local = payload({
      transactions: [transaction('t', 'a', 10)],
      updatedAt: '2026-08-10T00:00:00.000Z',
    });
    const remote = payload({
      transactions: [transaction('t', 'a', 20)],
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    const result = mergeLedgerPayloadsThreeWay(base, local, remote, {
      localRevision: 4,
      remoteRevision: 3,
    });
    expect(result.payload.transactions[0].amount).toBe(10);
  });

  it('never rolls a durable notification from read back to unread during a content edit', () => {
    const base = payload({ notifications: [notification('durable', false, 'base')] });
    const local = payload({ notifications: [notification('durable', true, 'base')] });
    const remote = payload({
      notifications: [notification('durable', false, 'edited')],
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    const result = mergeLedgerPayloadsThreeWay(base, local, remote);
    expect(result.payload.notifications[0]).toMatchObject({ title: 'edited', read: true });
  });

  it('keeps the currency used by a concurrently added transaction', () => {
    const base = payload();
    const local = payload({
      transactions: [{
        ...transaction('usd-buy'),
        currency: 'USD',
        fxRate: 7,
        amount: 1000,
      }],
    });
    const remote = payload({
      settings: { ...settings, baseCurrency: 'USD', displayCurrency: 'USD' },
      updatedAt: '2026-08-13T00:00:00.000Z',
    });

    const merged = mergeLedgerPayloadsThreeWay(base, local, remote);
    expect(merged.payload.settings.baseCurrency).toBe('CNY');
    expect(merged.payload.transactions[0]).toMatchObject({ currency: 'USD', fxRate: 7 });
  });

  it('refuses to mix financial records created under different base currencies', () => {
    const base = payload();
    const local = payload({ transactions: [transaction('cny-buy')] });
    const remote = payload({
      transactions: [{ ...transaction('usd-ledger-buy'), currency: 'USD', fxRate: 1 }],
      settings: { ...settings, baseCurrency: 'USD', displayCurrency: 'USD' },
    });
    expect(() => mergeLedgerPayloadsThreeWay(base, local, remote)).toThrow('本位币冲突');
  });
});

describe('sync outbox', () => {
  it('creates, serializes and parses an owner-bound entry', () => {
    const entry = createSyncOutbox({
      ownerUid: ' user-1 ',
      baseRevision: 7,
      baseFingerprint: 'ledger-v1-base',
      payload: payload({ instruments: [instrument('b'), instrument('a')] }),
      createdAt: '2026-08-12T12:00:00.000Z',
    });
    expect(entry.ownerUid).toBe('user-1');
    expect(entry.baseFingerprint).toBe('ledger-v1-base');
    expect(entry.payload.instruments.map((item) => item.id)).toEqual(['a', 'b']);
    expect(entry.fingerprint).toBe(ledgerFingerprint(entry.payload));
    expect(parseSyncOutbox(JSON.stringify(entry))).toEqual({ ok: true, value: entry });
  });

  it('round-trips an exact base payload and derives its fingerprint', () => {
    const base = payload({ transactions: [transaction('base')] });
    const entry = createSyncOutbox({
      ownerUid: 'user-1',
      baseRevision: 0,
      basePayload: base,
      payload: payload({ transactions: [] }),
    });
    expect(entry.baseFingerprint).toBe(ledgerFingerprint(base));
    expect(entry.basePayload).toEqual(canonicalizeLedgerPayload(base));
    expect(parseSyncOutbox(JSON.stringify(entry))).toEqual({ ok: true, value: entry });
  });

  it('rejects dirty JSON, old version, invalid owner/revision, and payload corruption', () => {
    expect(parseSyncOutbox('{').ok).toBe(false);
    const valid = createSyncOutbox({ ownerUid: 'u', baseRevision: 0, payload: payload() });
    for (const candidate of [
      { ...valid, version: 0 },
      { ...valid, ownerUid: '' },
      { ...valid, baseRevision: -1 },
      { ...valid, payload: { ...valid.payload, schemaVersion: 0 } },
    ]) {
      expect(parseSyncOutbox(candidate).ok).toBe(false);
    }
  });

  it('rejects a payload whose fingerprint was tampered or became stale', () => {
    const valid = createSyncOutbox({ ownerUid: 'u', baseRevision: 0, payload: payload() });
    expect(parseSyncOutbox({ ...valid, fingerprint: 'forged' }).ok).toBe(false);
    expect(parseSyncOutbox({
      ...valid,
      payload: payload({ instruments: [instrument('late-edit')] }),
    }).ok).toBe(false);
  });

  it('createSyncOutbox fails fast for invalid ownership, revision and payload', () => {
    expect(() => createSyncOutbox({ ownerUid: '', baseRevision: 0, payload: payload() })).toThrow();
    expect(() => createSyncOutbox({ ownerUid: 'u', baseRevision: 1.5, payload: payload() })).toThrow();
    expect(() => createSyncOutbox({
      ownerUid: 'u',
      baseRevision: 0,
      payload: { ...payload(), updatedAt: 'not-a-time' },
    })).toThrow();
  });
});

describe('owner-bound local cache', () => {
  it('round-trips a valid cache and canonicalizes its payload', () => {
    const cache = createLedgerOwnerCache(
      ' alice ',
      payload({ instruments: [instrument('b'), instrument('a')] }),
      '2026-08-12T12:00:00.000Z',
    );
    expect(cache.ownerUid).toBe('alice');
    expect(cache.payload.instruments.map((item) => item.id)).toEqual(['a', 'b']);
    expect(parseLedgerOwnerCache(JSON.stringify(cache))).toEqual({ ok: true, value: cache });
  });

  it('rejects a corrupt cache or stale fingerprint', () => {
    const cache = createLedgerOwnerCache('alice', payload());
    expect(parseLedgerOwnerCache({ ...cache, ownerUid: '' }).ok).toBe(false);
    expect(parseLedgerOwnerCache({ ...cache, fingerprint: 'forged' }).ok).toBe(false);
    expect(parseLedgerOwnerCache({ ...cache, payload: { ...cache.payload, schemaVersion: 2 } }).ok).toBe(false);
  });
});

describe('decideHydration', () => {
  it('blocks a stale outbox belonging to another signed-in user', () => {
    const outbox = createSyncOutbox({ ownerUid: 'alice', baseRevision: 1, payload: payload() });
    expect(decideHydration({
      ownerUid: 'bob',
      local: payload(),
      remote: payload({ instruments: [instrument('remote')] }),
      outbox,
    })).toEqual({ mode: 'BLOCK', reason: 'OUTBOX_OWNER_MISMATCH', outboxOwnerUid: 'alice' });
  });

  it('applies remote when there is no evidence of unsynced local work', () => {
    const remote = payload({ instruments: [instrument('remote')] });
    const result = decideHydration({ ownerUid: 'u', local: payload(), remote });
    expect(result).toMatchObject({ mode: 'APPLY_REMOTE', payload: remote, clearOutbox: false });
  });

  it('keeps an identical local ledger and clears no state', () => {
    const local = payload({ instruments: [instrument('a')] });
    const remote = { ...local, updatedAt: '2026-08-13T00:00:00.000Z' };
    expect(decideHydration({ ownerUid: 'u', local, remote })).toMatchObject({
      mode: 'KEEP_LOCAL',
      shouldUpload: false,
      reason: 'ALREADY_EQUAL',
    });
  });

  it('merges a matching dirty outbox with newer remote additions without loss', () => {
    const local = payload({
      instruments: [instrument('local')],
      updatedAt: '2026-08-12T01:00:00.000Z',
    });
    const outbox = createSyncOutbox({ ownerUid: 'u', baseRevision: 3, payload: local });
    const remote = payload({
      instruments: [instrument('remote')],
      updatedAt: '2026-08-12T02:00:00.000Z',
    });
    const result = decideHydration({ ownerUid: 'u', local, remote, outbox, remoteRevision: 4 });
    expect(result.mode).toBe('MERGE');
    if (result.mode === 'MERGE') {
      expect(result.reason).toBe('DIRTY_OUTBOX');
      expect(result.payload.instruments.map((item) => item.id)).toEqual(['local', 'remote']);
      expect(result.shouldUpload).toBe(true);
    }
  });

  it('keeps an outbox snapshot authoritative when remote is still its known base', () => {
    const remoteBase = payload({ transactions: [transaction('deleted-locally')] });
    const localAfterDelete = payload({ transactions: [] });
    const outbox = createSyncOutbox({
      ownerUid: 'u',
      baseRevision: 1,
      baseFingerprint: ledgerFingerprint(remoteBase),
      payload: localAfterDelete,
    });
    expect(decideHydration({
      ownerUid: 'u',
      local: localAfterDelete,
      remote: remoteBase,
      outbox,
    })).toMatchObject({
      mode: 'KEEP_LOCAL',
      payload: { transactions: [] },
      shouldUpload: true,
      reason: 'REMOTE_UNCHANGED_SINCE_BASE',
    });
  });

  it('three-way merges a deletion with a concurrent remote addition', () => {
    const base = payload({ transactions: [transaction('remove-me')] });
    const local = payload({ transactions: [] });
    const outbox = createSyncOutbox({
      ownerUid: 'u',
      baseRevision: 1,
      basePayload: base,
      payload: local,
    });
    const remote = payload({
      transactions: [transaction('remove-me'), transaction('remote-addition')],
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    const result = decideHydration({ ownerUid: 'u', local, remote, outbox });
    expect(result.mode).toBe('MERGE');
    if (result.mode === 'MERGE') {
      expect(result.payload.transactions.map((item) => item.id)).toEqual(['remote-addition']);
    }
  });

  it('detects dirty local state from a known base fingerprint even without an outbox', () => {
    const base = payload();
    const local = payload({ instruments: [instrument('local')] });
    const remote = payload({ instruments: [instrument('remote')] });
    const result = decideHydration({
      ownerUid: 'u',
      local,
      remote,
      knownBaseFingerprint: ledgerFingerprint(base),
    });
    expect(result.mode).toBe('MERGE');
    if (result.mode === 'MERGE') {
      expect(result.reason).toBe('LOCAL_CHANGED_SINCE_BASE');
      expect(result.payload.instruments.map((item) => item.id)).toEqual(['local', 'remote']);
    }
  });

  it('keeps dirty local data when the remote ledger does not exist yet', () => {
    const local = payload({ instruments: [instrument('local')] });
    const outbox = createSyncOutbox({ ownerUid: 'u', baseRevision: 0, payload: local });
    expect(decideHydration({ ownerUid: 'u', local, remote: null, outbox })).toMatchObject({
      mode: 'KEEP_LOCAL',
      shouldUpload: true,
      reason: 'NO_REMOTE',
    });
  });

  it('uses the outbox head when cache and remote still equal the old base', () => {
    const base = payload();
    const edited = payload({ instruments: [instrument('unsynced')] });
    const outbox = createSyncOutbox({
      ownerUid: 'u',
      baseRevision: 1,
      basePayload: base,
      payload: edited,
    });
    expect(decideHydration({ ownerUid: 'u', local: base, remote: base, outbox })).toMatchObject({
      mode: 'KEEP_LOCAL',
      payload: { instruments: [{ id: 'unsynced' }] },
      shouldUpload: true,
      reason: 'REMOTE_UNCHANGED_SINCE_BASE',
    });
  });

  it('uses the outbox head rather than stale cache when remote is absent', () => {
    const base = payload();
    const edited = payload({ instruments: [instrument('unsynced')] });
    const outbox = createSyncOutbox({ ownerUid: 'u', baseRevision: 0, payload: edited });
    expect(decideHydration({ ownerUid: 'u', local: base, remote: null, outbox })).toMatchObject({
      mode: 'KEEP_LOCAL',
      payload: { instruments: [{ id: 'unsynced' }] },
      shouldUpload: true,
      reason: 'NO_REMOTE',
    });
  });

  it('clears an outbox when remote already contains its semantic payload', () => {
    const local = payload({ instruments: [instrument('a')] });
    const outbox = createSyncOutbox({ ownerUid: 'u', baseRevision: 1, payload: local });
    const remote = { ...local, updatedAt: '2026-08-13T00:00:00.000Z' };
    const result = decideHydration({ ownerUid: 'u', local: payload(), remote, outbox, remoteRevision: 2 });
    expect(result).toMatchObject({
      mode: 'APPLY_REMOTE',
      clearOutbox: true,
      reason: 'REMOTE_ALREADY_CONTAINS_LOCAL',
    });
  });
});

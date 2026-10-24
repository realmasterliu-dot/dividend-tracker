import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@/types';
import type { CloudStore, LedgerPayload } from '../types';

const sdk = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('@cloudbase/js-sdk', () => ({ default: { init: sdk.init } }));

const settings: AppSettings = {
  baseCurrency: 'CNY',
  displayCurrency: 'CNY',
  colorScheme: 'CN',
  w8benFilled: false,
  fxNeutralMode: false,
  notificationChannels: {},
  stalenessThresholdHours: 48,
};

function payload(updatedAt = '2026-08-13T00:00:00.000Z'): LedgerPayload {
  return {
    schemaVersion: 1,
    instruments: [],
    transactions: [],
    plans: [],
    dividends: [],
    notifications: [],
    settings,
    updatedAt,
  };
}

let rows: unknown[] = [];
let operation: 'select' | 'insert' | 'update' = 'select';
let insertResponse: { data: null; error: null | { code?: string; message: string }; count: number } = {
  data: null,
  error: null,
  count: 1,
};
let updateResponse: { data: null; error: null | { code?: string; message: string }; count: number } = {
  data: null,
  error: null,
  count: 1,
};
const relationalQuery = {
  select: vi.fn(() => {
    operation = 'select';
    return relationalQuery;
  }),
  insert: vi.fn(() => {
    operation = 'insert';
    return relationalQuery;
  }),
  update: vi.fn(() => {
    operation = 'update';
    return relationalQuery;
  }),
  eq: vi.fn(() => relationalQuery),
  limit: vi.fn(() => relationalQuery),
  then: vi.fn((resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
    const response = operation === 'select'
      ? { data: rows, error: null, count: rows.length }
      : operation === 'insert' ? insertResponse : updateResponse;
    return Promise.resolve(response).then(resolve, reject);
  }),
};
const signIn = vi.fn(async () => ({ user: { uid: 'user-a', username: 'alice' } }));
const signOut = vi.fn(async () => undefined);
const fetchRegistration = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
  status: 201,
  headers: { 'Content-Type': 'application/json' },
}));
const relationalFrom = vi.fn(() => relationalQuery);
const rdb = vi.fn(() => ({ from: relationalFrom }));
const app = {
  auth: vi.fn(() => ({
    getLoginState: vi.fn(async () => ({ user: { uid: 'user-a' } })),
    signIn,
    signOut,
  })),
  rdb,
};

let store: CloudStore;

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_CLOUDBASE_ENV_ID', 'pg-env');
  vi.stubEnv('VITE_CLOUDBASE_DATABASE_KIND', 'postgresql');
  vi.stubEnv('VITE_CLOUDBASE_DATABASE_INSTANCE', 'pg-instance');
  vi.stubEnv('VITE_CLOUDBASE_DATABASE_NAME', 'pg-database');
  vi.stubEnv('VITE_CLOUDBASE_REGISTER_ENDPOINT', '/api/register');
  vi.stubGlobal('fetch', fetchRegistration);
  sdk.init.mockReturnValue(app);
  ({ cloudbaseStore: store } = await import('../cloudbaseStore'));
});

beforeEach(() => {
  rows = [];
  operation = 'select';
  insertResponse = { data: null, error: null, count: 1 };
  updateResponse = { data: null, error: null, count: 1 };
  rdb.mockClear();
  relationalFrom.mockClear();
  relationalQuery.select.mockClear();
  relationalQuery.insert.mockClear();
  relationalQuery.update.mockClear();
  relationalQuery.eq.mockClear();
  relationalQuery.limit.mockClear();
  relationalQuery.then.mockClear();
  fetchRegistration.mockClear();
  fetchRegistration.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  }));
  signIn.mockClear();
  signOut.mockClear();
});

describe('cloudbaseStore PostgreSQL adapter', () => {
  it('loads the owner row and its CAS revision', async () => {
    const source = payload();
    rows = [{
      user_id: 'user-a',
      data: source,
      settings,
      revision: 3,
      updated_at: source.updatedAt,
    }];

    await expect(store.load('user-a')).resolves.toEqual({ payload: source, revision: 3 });
    expect(rdb).toHaveBeenCalledWith();
    expect(relationalFrom).toHaveBeenCalledWith('user_ledgers');
    expect(relationalQuery.eq).toHaveBeenCalledWith('user_id', 'user-a');
  });

  it('creates a row using the existing user_id/data/settings schema', async () => {
    const source = payload();

    await expect(store.save(source, 'user-a', null)).resolves.toEqual({
      payload: source,
      revision: 1,
    });
    expect(relationalQuery.insert).toHaveBeenCalledWith({
      user_id: 'user-a',
      data: source,
      settings,
      revision: 1,
      updated_at: source.updatedAt,
    }, { count: 'exact' });
  });

  it('updates only the matching owner revision', async () => {
    const source = payload('2026-08-13T00:01:00.000Z');

    await expect(store.save(source, 'user-a', 4)).resolves.toEqual({
      payload: source,
      revision: 5,
    });
    expect(relationalQuery.update).toHaveBeenCalledWith({
      data: source,
      settings,
      revision: 5,
      updated_at: source.updatedAt,
    }, { count: 'exact' });
    expect(relationalQuery.eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(relationalQuery.eq).toHaveBeenCalledWith('revision', 4);
  });

  it('turns a stale PostgreSQL update into a sync conflict', async () => {
    updateResponse = { data: null, error: null, count: 0 };
    const error = await store.save(payload(), 'user-a', 1).catch((caught) => caught);
    expect(error).toMatchObject({ code: 'SYNC_CONFLICT' });
  });

  it('registers with CloudBase then redeems the invite in the protected members table', async () => {
    await expect(store.register(' alice ', 'Abcdef1!', ' invite-123 ')).resolves.toEqual({
      uid: 'user-a',
      username: 'alice',
    });

    expect(fetchRegistration).toHaveBeenCalledWith('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'Abcdef1!', inviteCode: 'invite-123' }),
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledWith({ username: 'alice', password: 'Abcdef1!' });
    expect(relationalFrom).toHaveBeenCalledWith('dividend_members');
    expect(relationalQuery.insert).toHaveBeenCalledWith({
      user_id: 'user-a',
      invite_code_hash: 'invite-123',
    });
  });

  it('signs the new account out when invite redemption is rejected', async () => {
    insertResponse = {
      data: null,
      error: { code: '42501', message: 'row-level security policy denied' },
      count: 0,
    };

    await expect(store.register('alice', 'Abcdef1!', 'wrong')).rejects.toThrow(
      '邀请码无效、已停用或已过期',
    );
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('does not sign in when the registration function rejects the invite', async () => {
    fetchRegistration.mockResolvedValueOnce(new Response(
      JSON.stringify({ ok: false, code: 'INVALID_INVITE' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(store.register('alice', 'Abcdef1!', 'wrong')).rejects.toThrow(
      '邀请码无效、已停用或已过期',
    );
    expect(signIn).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it.each(['ACCOUNT_EXISTS', 'LIMIT_EXCEEDED', 'CREATE_FAILED'] as const)(
    'resumes invite redemption after account creation returned %s',
    async (code) => {
      fetchRegistration.mockResolvedValueOnce(new Response(
        JSON.stringify({ ok: false, code }),
        { status: code === 'LIMIT_EXCEEDED' ? 429 : 500, headers: { 'Content-Type': 'application/json' } },
      ));

      await expect(store.register('alice', 'Abcdef1!', 'invite-123')).resolves.toEqual({
        uid: 'user-a',
        username: 'alice',
      });
      expect(signIn).toHaveBeenCalledWith({ username: 'alice', password: 'Abcdef1!' });
      expect(relationalQuery.insert).toHaveBeenCalledWith({
        user_id: 'user-a',
        invite_code_hash: 'invite-123',
      });
    },
  );
});

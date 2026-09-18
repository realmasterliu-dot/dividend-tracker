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

function payload(updatedAt = '2026-08-12T00:00:00.000Z'): LedgerPayload {
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

let currentUid = 'user-a';
let documents: unknown[] = [];

const getLoginState = vi.fn(async () => ({ user: { uid: currentUid } }));
const signIn = vi.fn();
const signOut = vi.fn();
const queryGet = vi.fn(async () => ({ data: documents }));
const queryUpdate = vi.fn(async (_update: object) => ({ requestId: 'update-request', updated: 1 }));
const query = {
  limit: vi.fn(() => query),
  get: queryGet,
  update: queryUpdate,
};
const collectionAdd = vi.fn(async (_document: object) => ({ requestId: 'add-request', id: 'fixed-id' }));
const collection = {
  where: vi.fn((_condition: object) => query),
  add: collectionAdd,
};
const app = {
  auth: vi.fn(() => ({ getLoginState, signIn, signOut })),
  database: vi.fn(() => ({ collection: vi.fn(() => collection) })),
};

let store: CloudStore;

beforeAll(async () => {
  vi.stubEnv('VITE_CLOUDBASE_ENV_ID', 'test-env');
  sdk.init.mockReturnValue(app);
  ({ cloudbaseStore: store } = await import('../cloudbaseStore'));
});

beforeEach(() => {
  currentUid = 'user-a';
  documents = [];
  getLoginState.mockClear();
  queryGet.mockClear();
  queryGet.mockImplementation(async () => ({ data: documents }));
  queryUpdate.mockClear();
  queryUpdate.mockImplementation(async (_update: object) => ({ requestId: 'update-request', updated: 1 }));
  query.limit.mockClear();
  collection.where.mockClear();
  collectionAdd.mockClear();
  collectionAdd.mockImplementation(async (_document: object) => ({ requestId: 'add-request', id: 'fixed-id' }));
});

describe('cloudbaseStore ledger boundary', () => {
  it('loads the newest legacy primary as revision zero and validates its payload', async () => {
    const older = payload('2026-08-10T00:00:00.000Z');
    const newer = payload('2026-08-12T00:00:00.000Z');
    documents = [
      { _id: 'legacy-old', ledgerKey: 'primary', payload: older, updatedAt: older.updatedAt },
      { _id: 'legacy-new', ledgerKey: 'primary', payload: newer, updatedAt: newer.updatedAt },
    ];

    await expect(store.load('user-a')).resolves.toEqual({ payload: newer, revision: 0 });
    expect(query.limit).toHaveBeenCalledWith(100);
    expect(getLoginState).toHaveBeenCalledTimes(2);
  });

  it('rejects a corrupt remote payload with an actionable error', async () => {
    documents = [{
      _id: 'legacy-corrupt',
      ledgerKey: 'primary',
      payload: { ...payload(), transactions: 'not-an-array' },
      updatedAt: '2026-08-12T00:00:00.000Z',
    }];

    await expect(store.load('user-a')).rejects.toThrow(
      /云端账本读取失败（文档 legacy-corrupt）：数据格式已损坏.*payload\.transactions/,
    );
  });

  it('creates an owner-bound deterministic document and returns revision one', async () => {
    const source = payload();

    await expect(store.save(source, 'user-a', null)).resolves.toEqual({
      payload: source,
      revision: 1,
    });

    expect(collectionAdd).toHaveBeenCalledOnce();
    expect(collectionAdd).toHaveBeenCalledWith(expect.objectContaining({
      _id: expect.stringMatching(/^[0-9a-f]{24}$/),
      ownerUid: 'user-a',
      ledgerKey: 'primary',
      revision: 1,
      payload: source,
    }));
    expect(collection.where).not.toHaveBeenCalled();
  });

  it('maps a concurrent deterministic first-create duplicate to SYNC_CONFLICT', async () => {
    collectionAdd.mockRejectedValueOnce({
      code: 'DATABASE_REQUEST_FAILED',
      message: 'E11000 duplicate key error',
    });

    const error = await store.save(payload(), 'user-a', null).catch((caught) => caught);

    expect(error).toMatchObject({ name: 'CloudSyncConflictError', code: 'SYNC_CONFLICT' });
    expect(error.message).toContain('SYNC_CONFLICT');
  });

  it('migrates a legacy random-id ledger through a first create without deleting it', async () => {
    const legacy = payload();
    documents = [{ _id: 'legacy-id', ledgerKey: 'primary', payload: legacy, updatedAt: legacy.updatedAt }];

    await expect(
      store.save(payload('2026-08-12T00:01:00.000Z'), 'user-a', 0),
    ).resolves.toMatchObject({ revision: 1 });

    expect(collectionAdd).toHaveBeenCalledOnce();
    expect(collectionAdd.mock.calls[0][0]).toEqual(expect.objectContaining({
      _id: expect.not.stringMatching(/^legacy-id$/),
      ownerUid: 'user-a',
      revision: 1,
    }));
  });

  it('updates an existing deterministic document only at the expected owner and revision', async () => {
    await store.save(payload(), 'user-a', null);
    const deterministicId = (collectionAdd.mock.calls[0][0] as { _id: string })._id;
    const previous = payload();
    documents = [{
      _id: deterministicId,
      ownerUid: 'user-a',
      ledgerKey: 'primary',
      payload: previous,
      revision: 4,
      updatedAt: previous.updatedAt,
    }];
    collectionAdd.mockClear();
    collection.where.mockClear();
    const next = payload('2026-08-12T00:01:00.000Z');

    await expect(store.save(next, 'user-a', 4)).resolves.toEqual({ payload: next, revision: 5 });

    expect(collection.where).toHaveBeenLastCalledWith({
      _id: deterministicId,
      _openid: '{openid}',
      ownerUid: 'user-a',
      revision: 4,
    });
    expect(queryUpdate).toHaveBeenCalledWith({
      payload: next,
      revision: 5,
      updatedAt: next.updatedAt,
    });
    expect(collectionAdd).not.toHaveBeenCalled();
  });

  it('turns a stale CAS update into a recognizable sync conflict', async () => {
    await store.save(payload(), 'user-a', null);
    const deterministicId = (collectionAdd.mock.calls[0][0] as { _id: string })._id;
    documents = [{
      _id: deterministicId,
      ownerUid: 'user-a',
      ledgerKey: 'primary',
      payload: payload(),
      revision: 2,
      updatedAt: payload().updatedAt,
    }];
    queryUpdate.mockResolvedValueOnce({ requestId: 'update-request', updated: 0 });

    const error = await store.save(payload(), 'user-a', 1).catch((caught) => caught);

    expect(error).toMatchObject({ name: 'CloudSyncConflictError', code: 'SYNC_CONFLICT' });
  });

  it('cancels a read if the authenticated account changes before it completes', async () => {
    queryGet.mockImplementationOnce(async () => {
      currentUid = 'user-b';
      return { data: [] };
    });

    await expect(store.load('user-a')).rejects.toThrow('云端账号已切换');
    expect(getLoginState).toHaveBeenCalledTimes(2);
  });

  it('cancels a write if the authenticated account changes while it is in flight', async () => {
    collectionAdd.mockImplementationOnce(async (_document: object) => {
      currentUid = 'user-b';
      return { requestId: 'add-request', id: 'fixed-id' };
    });

    await expect(store.save(payload(), 'user-a', null)).rejects.toThrow('云端账号已切换');
    expect(collectionAdd).toHaveBeenCalledOnce();
  });
});

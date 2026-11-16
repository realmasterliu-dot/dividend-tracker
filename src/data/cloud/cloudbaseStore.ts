import { cloudConfig } from '@/config/cloud';
import type {
  CloudLedgerDocument,
  CloudLedgerSnapshot,
  CloudStore,
  CloudUser,
  LedgerPayload,
} from './types';
import { parseLedgerPayload } from './sync';

type CloudbaseApp = cloudbase.app.App;
type CloudbaseDatabase = ReturnType<CloudbaseApp['database']>;

interface RelationalError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

interface RelationalResponse<T = unknown> {
  data: T | null;
  error: RelationalError | null;
  count?: number | null;
}

interface RelationalBuilder<T = unknown> extends PromiseLike<RelationalResponse<T>> {
  select(columns?: string, options?: { count?: 'exact'; head?: boolean }): RelationalBuilder<T>;
  insert(values: unknown, options?: { count?: 'exact' }): RelationalBuilder<T>;
  update(values: unknown, options?: { count?: 'exact' }): RelationalBuilder<T>;
  eq(column: string, value: unknown): RelationalBuilder<T>;
  limit(count: number): RelationalBuilder<T>;
}

interface RelationalDatabase {
  from<T = unknown>(table: string): RelationalBuilder<T>;
}

interface PostgresLedgerRow {
  user_id?: string;
  data?: unknown;
  settings?: unknown;
  revision?: number;
  updated_at?: string;
}

interface RegisterFunctionResult {
  ok: boolean;
  code?: 'INVALID_USERNAME' | 'INVALID_PASSWORD' | 'INVALID_INVITE' | 'ACCOUNT_EXISTS' | 'LIMIT_EXCEEDED' | 'CREATE_FAILED';
}

let appPromise: Promise<CloudbaseApp> | null = null;

async function getApp(): Promise<CloudbaseApp> {
  if (!cloudConfig.envId) throw new Error('尚未配置 CloudBase 环境');
  if (!appPromise) {
    appPromise = import('@cloudbase/js-sdk').then((cloudbase) =>
      cloudbase.default.init({
        env: cloudConfig.envId,
        region: cloudConfig.region,
        persistence: 'local',
      }),
    );
  }
  return appPromise;
}

function getDatabase(app: CloudbaseApp): CloudbaseDatabase {
  return app.database();
}

function getRelationalDatabase(app: CloudbaseApp): RelationalDatabase {
  const rdb = (app as unknown as {
    rdb?: () => RelationalDatabase;
  }).rdb;
  if (typeof rdb !== 'function') {
    throw new Error('当前 CloudBase SDK 不支持 PostgreSQL，请刷新后重试');
  }
  // A CloudBase PostgreSQL environment has a built-in default database.
  // Passing the CynosDB instance id here is interpreted as a connector id
  // and causes DATABASE_REQUEST_FAILED, so PG mode must use app.rdb().
  return rdb.call(app);
}

function userFromLoginState(loginState: cloudbase.auth.ILoginState | null): CloudUser | null {
  const user = loginState?.user;
  const uid = user?.uid ?? user?.openid;
  if (!user || !uid) return null;
  return { uid, username: user.username, email: user.email };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const nestedData = typeof record.data === 'object' && record.data !== null
      ? record.data as Record<string, unknown>
      : null;
    const nestedError = typeof record.error === 'object' && record.error !== null
      ? record.error as Record<string, unknown>
      : null;
    const message = record.message ?? record.error_description ?? record.code
      ?? nestedData?.message ?? nestedData?.code
      ?? nestedError?.message ?? nestedError?.code;
    if (typeof message === 'string') return message;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Fall through to the generic description below.
    }
    return '云端返回了无法识别的错误';
  }
  return String(error);
}

function assertRelationalSuccess<T>(
  result: RelationalResponse<T>,
  context: string,
): asserts result is RelationalResponse<T> & { error: null } {
  if (!result.error) return;
  const details = result.error.message ?? result.error.details ?? result.error.hint
    ?? result.error.code ?? '未知数据库错误';
  const error = new Error(`${context}：${details}`) as Error & { code?: string };
  error.code = result.error.code;
  throw error;
}

function registrationError(error: unknown): Error {
  const message = errorMessage(error);
  if (error instanceof Error && message.startsWith('注册失败：')) return error;
  if (/duplicate|already|exist|已存在|重复/i.test(message)) {
    return new Error('注册失败：这个账号已经存在，请直接登录');
  }
  if (/invite|permission|policy|row-level|rls|denied|无权限/i.test(message)) {
    return new Error('注册失败：邀请码无效、已停用或已过期');
  }
  return new Error(`注册失败：${message}`);
}

function registrationFunctionError(code?: RegisterFunctionResult['code']): Error {
  if (code === 'INVALID_USERNAME') return new Error('注册失败：账号格式不正确');
  if (code === 'INVALID_PASSWORD') return new Error('注册失败：密码格式不正确');
  if (code === 'INVALID_INVITE') return new Error('注册失败：邀请码无效、已停用或已过期');
  if (code === 'ACCOUNT_EXISTS') return new Error('注册失败：这个账号已经存在，请直接登录');
  if (code === 'LIMIT_EXCEEDED') return new Error('注册失败：CloudBase 账号创建已达到当前限制');
  return new Error('注册失败：云端暂时无法创建账号，请稍后重试');
}

async function requestRegistration(
  username: string,
  password: string,
  inviteCode: string,
): Promise<RegisterFunctionResult> {
  const response = await fetch(cloudConfig.registerEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, inviteCode }),
  });
  let result: RegisterFunctionResult | null = null;
  try {
    result = await response.json() as RegisterFunctionResult;
  } catch {
    throw new Error('注册失败：云端返回了无法识别的结果');
  }
  if (!response.ok && !result?.code) {
    throw new Error(`注册失败：云端服务暂时不可用（${response.status}）`);
  }
  return result;
}

async function currentUser(): Promise<CloudUser> {
  const app = await getApp();
  const user = userFromLoginState(await app.auth().getLoginState());
  if (!user) throw new Error('请先登录云端账号');
  return user;
}

async function assertUser(expectedUid: string): Promise<CloudUser> {
  const user = await currentUser();
  if (!expectedUid || user.uid !== expectedUid) {
    throw new Error('云端账号已切换，已取消旧账号的数据操作');
  }
  return user;
}

/**
 * A stable, opaque 24-hex document id makes the first write idempotent and
 * remains compatible with clients that apply Mongo-style id validation.
 * Keeping the uid itself out of the id avoids leaking an account identifier.
 */
function primaryDocumentId(uid: string): string {
  let hash64 = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  let hash32 = 0x811c9dc5;
  for (let index = 0; index < uid.length; index += 1) {
    const code = uid.charCodeAt(index);
    hash64 ^= BigInt(code);
    hash64 = BigInt.asUintN(64, hash64 * prime);
    hash32 ^= code;
    hash32 = Math.imul(hash32, 0x01000193) >>> 0;
  }
  return `${hash64.toString(16).padStart(16, '0')}${hash32.toString(16).padStart(8, '0')}`;
}

function documentTimestamp(document: Partial<CloudLedgerDocument>): number {
  const candidate = document.updatedAt ?? document.payload?.updatedAt;
  if (typeof candidate !== 'string') return 0;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function selectPrimaryDocument(
  documents: Partial<CloudLedgerDocument>[],
  expectedUid: string,
): Partial<CloudLedgerDocument> | null {
  if (documents.length === 0) return null;
  const deterministicId = primaryDocumentId(expectedUid);
  const deterministic = documents.find((document) => document._id === deterministicId);
  if (deterministic) return deterministic;

  // Compatibility path for installations created before deterministic ids.
  // Do not delete old records: the next save writes the deterministic document.
  return [...documents].sort((left, right) => documentTimestamp(right) - documentTimestamp(left))[0];
}

function isDeterministicDocument(
  document: Partial<CloudLedgerDocument>,
  expectedUid: string,
): boolean {
  return document._id === primaryDocumentId(expectedUid);
}

function snapshotFromDocument(
  document: Partial<CloudLedgerDocument>,
  expectedUid: string,
): CloudLedgerSnapshot {
  const payload = validatedPayload(document.payload, '读取', document._id);
  if (!isDeterministicDocument(document, expectedUid)) {
    return { payload, revision: 0 };
  }
  if (document.ownerUid !== expectedUid) {
    throw new Error(`云端账本读取失败（文档 ${document._id}）：账号归属信息无效`);
  }
  if (!Number.isInteger(document.revision) || (document.revision ?? -1) < 0) {
    throw new Error(`云端账本读取失败（文档 ${document._id}）：版本号无效`);
  }
  return { payload, revision: document.revision as number };
}

function validatedPayload(
  input: unknown,
  context: '读取' | '保存',
  documentId?: string,
): LedgerPayload {
  const parsed = parseLedgerPayload(input);
  if (parsed.ok) return parsed.value;
  const location = documentId ? `（文档 ${documentId}）` : '';
  const details = parsed.issues.slice(0, 5).join('；');
  throw new Error(`云端账本${context}失败${location}：数据格式已损坏。${details}`);
}

function payloadFromPostgresRow(row: PostgresLedgerRow): LedgerPayload {
  const direct = parseLedgerPayload(row.data);
  if (direct.ok) return direct.value;

  // Compatibility with the first PostgreSQL deployment, which stored the
  // ledger slices in `data` and settings in a separate JSONB column.
  const legacy = typeof row.data === 'object' && row.data !== null
    ? (row.data as Record<string, unknown>)
    : null;
  if (legacy) {
    const candidate = {
      schemaVersion: 1,
      instruments: legacy.instruments ?? [],
      transactions: legacy.transactions ?? [],
      plans: legacy.plans ?? [],
      dividends: legacy.dividends ?? [],
      notifications: legacy.notifications ?? [],
      settings: row.settings ?? legacy.settings,
      updatedAt: legacy.updatedAt ?? row.updated_at,
    };
    const parsed = parseLedgerPayload(candidate);
    if (parsed.ok) return parsed.value;
  }

  const details = direct.issues.slice(0, 5).join('；');
  throw new Error(`云端账本读取失败（PostgreSQL）：数据格式已损坏。${details}`);
}

function snapshotFromPostgresRow(
  row: PostgresLedgerRow,
  expectedUid: string,
): CloudLedgerSnapshot {
  if (row.user_id !== expectedUid) {
    throw new Error('云端账本读取失败（PostgreSQL）：账号归属信息无效');
  }
  if (!Number.isInteger(row.revision) || (row.revision ?? 0) < 1) {
    throw new Error('云端账本读取失败（PostgreSQL）：版本号无效');
  }
  return {
    payload: payloadFromPostgresRow(row),
    revision: row.revision as number,
  };
}

async function loadPostgresLedger(
  app: CloudbaseApp,
  expectedUid: string,
): Promise<CloudLedgerSnapshot | null> {
  await assertUser(expectedUid);
  let result: RelationalResponse<PostgresLedgerRow[]>;
  try {
    result = await getRelationalDatabase(app)
      .from<PostgresLedgerRow[]>(cloudConfig.collection)
      .select('*')
      .eq('user_id', expectedUid)
      .limit(1);
  } catch (error) {
    await assertUser(expectedUid);
    throw error;
  }
  await assertUser(expectedUid);
  assertRelationalSuccess(result, '云端账本读取失败');
  const rows = Array.isArray(result.data) ? result.data : [];
  return rows[0] ? snapshotFromPostgresRow(rows[0], expectedUid) : null;
}

async function listPrimaryDocuments(
  app: CloudbaseApp,
  expectedUid: string,
): Promise<Partial<CloudLedgerDocument>[]> {
  await assertUser(expectedUid);
  let result: cloudbase.database.GetRes;
  try {
    result = await getDatabase(app)
      .collection(cloudConfig.collection)
      .where({ _openid: '{openid}', ledgerKey: 'primary' })
      .limit(100)
      .get();
  } catch (error) {
    await assertUser(expectedUid);
    throw error;
  }
  await assertUser(expectedUid);
  return Array.isArray(result.data) ? (result.data as Partial<CloudLedgerDocument>[]) : [];
}

function syncConflict(message = '云端账本已被其他设备更新，请重新同步后再保存'): Error {
  const error = new Error(`SYNC_CONFLICT：${message}`) as Error & { code: 'SYNC_CONFLICT' };
  error.name = 'CloudSyncConflictError';
  error.code = 'SYNC_CONFLICT';
  return error;
}

function isDuplicateDocumentError(error: unknown): boolean {
  const record = typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)
    : null;
  const text = [record?.code, record?.message, record?.error_description, error]
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .join(' ')
    .toLowerCase();
  return (
    text.includes('duplicate') ||
    text.includes('duplicate_key') ||
    text.includes('e11000') ||
    text.includes('already exists') ||
    text.includes('already_exist') ||
    text.includes('document_exists') ||
    text.includes('document exists')
  );
}

async function createPrimaryDocument(
  app: CloudbaseApp,
  payload: LedgerPayload,
  expectedUid: string,
): Promise<CloudLedgerSnapshot> {
  const revision = 1;
  await assertUser(expectedUid);
  try {
    await getDatabase(app).collection(cloudConfig.collection).add({
      _id: primaryDocumentId(expectedUid),
      ownerUid: expectedUid,
      ledgerKey: 'primary' as const,
      payload,
      revision,
      updatedAt: payload.updatedAt,
    });
  } catch (error) {
    await assertUser(expectedUid);
    if (isDuplicateDocumentError(error)) throw syncConflict('另一台设备已经创建了云端账本');
    throw error;
  }
  await assertUser(expectedUid);
  return { payload, revision };
}

async function updatePrimaryDocument(
  app: CloudbaseApp,
  payload: LedgerPayload,
  expectedUid: string,
  expectedRevision: number,
): Promise<CloudLedgerSnapshot> {
  const nextRevision = expectedRevision + 1;
  await assertUser(expectedUid);
  let result: cloudbase.database.UpdateRes;
  try {
    result = await getDatabase(app)
      .collection(cloudConfig.collection)
      .where({
        _id: primaryDocumentId(expectedUid),
        _openid: '{openid}',
        ownerUid: expectedUid,
        revision: expectedRevision,
      })
      .update({ payload, revision: nextRevision, updatedAt: payload.updatedAt });
  } catch (error) {
    await assertUser(expectedUid);
    throw error;
  }
  await assertUser(expectedUid);
  if (result.updated !== 1) throw syncConflict();
  return { payload, revision: nextRevision };
}

async function savePostgresLedger(
  app: CloudbaseApp,
  payload: LedgerPayload,
  expectedUid: string,
  expectedRevision: number | null,
): Promise<CloudLedgerSnapshot> {
  await assertUser(expectedUid);
  if (expectedRevision === null) {
    try {
      const result = await getRelationalDatabase(app).from(cloudConfig.collection).insert({
        user_id: expectedUid,
        data: payload,
        settings: payload.settings,
        revision: 1,
        updated_at: payload.updatedAt,
      }, { count: 'exact' });
      assertRelationalSuccess(result, '云端账本创建失败');
    } catch (error) {
      await assertUser(expectedUid);
      if (isDuplicateDocumentError(error)) {
        throw syncConflict('另一台设备已经创建了云端账本');
      }
      throw error;
    }
    await assertUser(expectedUid);
    return { payload, revision: 1 };
  }

  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw syncConflict('本地同步版本无效');
  }
  const nextRevision = expectedRevision + 1;
  let result: RelationalResponse<unknown>;
  try {
    result = await getRelationalDatabase(app)
      .from(cloudConfig.collection)
      .update({
        data: payload,
        settings: payload.settings,
        revision: nextRevision,
        updated_at: payload.updatedAt,
      }, { count: 'exact' })
      .eq('user_id', expectedUid)
      .eq('revision', expectedRevision);
  } catch (error) {
    await assertUser(expectedUid);
    throw error;
  }
  await assertUser(expectedUid);
  assertRelationalSuccess(result, '云端账本更新失败');
  if (result.count !== 1) throw syncConflict();
  return { payload, revision: nextRevision };
}

export const cloudbaseStore: CloudStore = {
  async restoreSession() {
    const app = await getApp();
    return userFromLoginState(await app.auth().getLoginState());
  },

  async signIn(username, password) {
    const app = await getApp();
    try {
      const loginState = await app.auth().signIn({ username, password });
      const user = userFromLoginState(loginState);
      if (!user) throw new Error('CloudBase 未返回有效登录用户');
      return user;
    } catch (error) {
      throw new Error(`登录失败：${errorMessage(error)}`);
    }
  },

  async register(username, password, inviteCode) {
    const app = await getApp();
    const auth = app.auth();
    const cleanUsername = username.trim();
    const cleanInviteCode = inviteCode.trim();
    let signedIn = false;
    try {
      const registration = await requestRegistration(cleanUsername, password, cleanInviteCode);
      // Account creation and invite redemption are two separate cloud writes.
      // If the first attempt created the account but the browser was unable to
      // redeem the invite, a retry reports ACCOUNT_EXISTS (or, on some plans,
      // LIMIT_EXCEEDED). Signing in with the supplied password safely resumes
      // that interrupted registration instead of stranding the account.
      if (!registration.ok && ![
        'ACCOUNT_EXISTS',
        'LIMIT_EXCEEDED',
        'CREATE_FAILED',
      ].includes(registration.code ?? '')) {
        throw registrationFunctionError(registration.code);
      }
      let loginState: cloudbase.auth.ILoginState;
      try {
        loginState = await auth.signIn({ username: cleanUsername, password });
      } catch (error) {
        if (!registration.ok) throw registrationFunctionError(registration.code);
        throw error;
      }
      const user = userFromLoginState(loginState);
      if (!user) throw new Error('CloudBase 未返回有效注册用户');
      signedIn = true;
      if (cloudConfig.databaseKind !== 'postgresql') {
        throw new Error('当前云端数据库尚未启用邀请码注册');
      }
      try {
        const membership = await getRelationalDatabase(app).from(cloudConfig.membersTable).insert({
          user_id: user.uid,
          // The PostgreSQL trigger validates this one-time plaintext input and
          // replaces it with a hash before the row is stored.
          invite_code_hash: cleanInviteCode,
        });
        assertRelationalSuccess(membership, '邀请码登记失败');
      } catch (error) {
        // A completed earlier redemption makes retries idempotent.
        if (!/23505|duplicate|already|exist|重复|已存在/i.test(errorMessage(error))) throw error;
      }
      await assertUser(user.uid);
      return user;
    } catch (error) {
      if (signedIn) {
        try {
          await auth.signOut();
        } catch {
          // Preserve the original registration error. AuthContext keeps the
          // ledger hidden until a confirmed account is returned.
        }
      }
      throw registrationError(error);
    }
  },

  async signOut() {
    const app = await getApp();
    await app.auth().signOut();
  },

  async load(expectedUid) {
    const app = await getApp();
    if (cloudConfig.databaseKind === 'postgresql') {
      return loadPostgresLedger(app, expectedUid);
    }
    const documents = await listPrimaryDocuments(app, expectedUid);
    const document = selectPrimaryDocument(documents, expectedUid);
    if (!document) return null;
    return snapshotFromDocument(document, expectedUid);
  },

  async save(payload, expectedUid, expectedRevision) {
    const safePayload = validatedPayload(payload, '保存');
    const app = await getApp();

    if (cloudConfig.databaseKind === 'postgresql') {
      return savePostgresLedger(app, safePayload, expectedUid, expectedRevision);
    }

    if (expectedRevision === null) {
      return createPrimaryDocument(app, safePayload, expectedUid);
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw syncConflict('本地同步版本无效');
    }

    const documents = await listPrimaryDocuments(app, expectedUid);
    const deterministic = documents.find((document) =>
      isDeterministicDocument(document, expectedUid),
    );
    if (!deterministic) {
      // A legacy random-id document is represented as revision 0 on load. Its
      // first post-upgrade save creates the deterministic CAS document.
      if (expectedRevision === 0) {
        return createPrimaryDocument(app, safePayload, expectedUid);
      }
      throw syncConflict('云端账本已被删除或迁移');
    }

    return updatePrimaryDocument(app, safePayload, expectedUid, expectedRevision);
  },
};

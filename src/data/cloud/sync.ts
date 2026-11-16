import type {
  AppSettings,
  DividendEvent,
  Instrument,
  InvestmentPlan,
  Notification,
  Transaction,
} from '@/types';
import type { LedgerPayload } from './types';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: string[] };

export type LedgerSlice =
  | 'instruments'
  | 'transactions'
  | 'plans'
  | 'dividends'
  | 'notifications'
  | 'settings';

export interface LedgerMergeConflict {
  slice: LedgerSlice;
  key: string;
  winner: 'local' | 'remote';
}

export interface MergeLedgerOptions {
  localRevision?: number;
  remoteRevision?: number;
  /** Revisions and timestamps being equal is ambiguous. The default is remote. */
  prefer?: 'local' | 'remote';
}

export interface MergeLedgerResult {
  payload: LedgerPayload;
  conflicts: LedgerMergeConflict[];
  winner: 'local' | 'remote';
}

export interface SyncOutboxEntry {
  version: 1;
  ownerUid: string;
  baseRevision: number;
  /** Semantic fingerprint of the last cloud ledger observed before this edit. */
  baseFingerprint?: string;
  /** Exact clean base enables three-way merge, including intentional deletions. */
  basePayload?: LedgerPayload;
  payload: LedgerPayload;
  fingerprint: string;
  createdAt: string;
}

export interface CreateSyncOutboxInput {
  ownerUid: string;
  baseRevision: number;
  baseFingerprint?: string;
  basePayload?: LedgerPayload;
  payload: LedgerPayload;
  createdAt?: string;
}

export type HydrationDecision =
  | {
      mode: 'APPLY_REMOTE';
      payload: LedgerPayload;
      clearOutbox: boolean;
      reason: 'REMOTE_AUTHORITATIVE' | 'REMOTE_ALREADY_CONTAINS_LOCAL';
    }
  | {
      mode: 'KEEP_LOCAL';
      payload: LedgerPayload;
      shouldUpload: boolean;
      reason: 'NO_REMOTE' | 'ALREADY_EQUAL' | 'REMOTE_UNCHANGED_SINCE_BASE';
    }
  | {
      mode: 'MERGE';
      payload: LedgerPayload;
      conflicts: LedgerMergeConflict[];
      shouldUpload: true;
      reason: 'DIRTY_OUTBOX' | 'LOCAL_CHANGED_SINCE_BASE';
    }
  | {
      mode: 'BLOCK';
      reason: 'OUTBOX_OWNER_MISMATCH';
      outboxOwnerUid: string;
    };

export interface DecideHydrationInput {
  ownerUid: string;
  local: LedgerPayload;
  remote: LedgerPayload | null;
  outbox?: SyncOutboxEntry | null;
  remoteRevision?: number;
  /** Fingerprint of the last remote state known to have been applied locally. */
  knownBaseFingerprint?: string | null;
}

export interface LedgerOwnerCache {
  version: 1;
  ownerUid: string;
  payload: LedgerPayload;
  fingerprint: string;
  savedAt: string;
}

type JsonRecord = Record<string, unknown>;

const MARKETS = ['A_SHARE', 'HK', 'US', 'FUND', 'CRYPTO', 'GOLD'] as const;
const CURRENCIES = ['CNY', 'USD', 'HKD'] as const;
const SECURITY_TYPES = ['COMMON', 'REIT', 'MLP_PTP', 'ADR', 'ETF', 'FUND', 'CRYPTO', 'GOLD'] as const;
const DIVIDEND_OPTIONS = ['CASH', 'REINVEST'] as const;
const CUSTODY_CHANNELS = [
  'CN_BROKER',
  'HK_LOCAL_BROKER',
  'HK_STOCK_CONNECT',
  'US_BROKER',
  'CEX',
  'SGE',
  'PHYSICAL',
] as const;
const GOLD_FORMS = ['PHYSICAL', 'ACCUMULATION', 'ETF', 'TD', 'XAU'] as const;
const TRANSACTION_TYPES = [
  'BUY',
  'SELL',
  'DIVIDEND_CASH',
  'DIVIDEND_REINVEST',
  'SPLIT',
  'BONUS',
  'TRANSFER',
  'FUND_SPLIT',
  'FEE',
  'INCOME',
  'TAX_WITHHELD',
] as const;
const TRANSACTION_STATUSES = ['CONFIRMED', 'PENDING', 'VOIDED'] as const;
const TRANSACTION_SOURCES = ['MANUAL', 'DCA', 'IMPORT', 'SYSTEM'] as const;
const PLAN_FREQUENCIES = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;
const PLAN_STATUSES = ['ACTIVE', 'PAUSED', 'ENDED'] as const;
const HOLIDAY_POLICIES = ['NEXT_TRADING_DAY', 'PREV_TRADING_DAY'] as const;
const DIVIDEND_STATUSES = [
  'PROPOSED',
  'APPROVED',
  'DECLARED',
  'EX_DIVIDEND',
  'PAID',
  'RECONCILED',
] as const;
const TAX_BRACKETS = ['LE1M', 'M1_1Y', 'GT1Y', 'NONE'] as const;
const DIVIDEND_FORMS = ['CASH', 'SCRIP', 'CASH_SCRIP'] as const;
const NOTIFICATION_TYPES = [
  'DIVIDEND_PROPOSED',
  'DIVIDEND_DECLARED',
  'RECORD_DATE_CLOSE',
  'EX_DATE',
  'PAY_DATE',
  'DCA_PENDING',
  'SOURCE_ERROR',
  'CORP_ACTION',
  'TAX_BRACKET',
  'DATA_STALE',
] as const;
const SEVERITIES = ['INFO', 'WARN', 'ERROR'] as const;
const COLOR_SCHEMES = ['CN', 'INTL', 'COLORBLIND'] as const;

const LEDGER_KEYS = [
  'schemaVersion',
  'instruments',
  'transactions',
  'plans',
  'dividends',
  'notifications',
  'settings',
  'updatedAt',
] as const;

function isRecord(value: unknown): value is JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseUnknownInput(value: unknown): ParseResult<unknown> {
  if (typeof value !== 'string') return { ok: true, value };
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false, issues: ['input: invalid JSON'] };
  }
}

function validateJsonValue(value: unknown, path: string, issues: string[], ancestors: Set<object>): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push(`${path}: must be a finite JSON number`);
    return;
  }
  if (typeof value !== 'object') {
    issues.push(`${path}: must be JSON-serializable`);
    return;
  }
  if (ancestors.has(value)) {
    issues.push(`${path}: cyclic values are not allowed`);
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${path}[${index}]`, issues, ancestors));
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) =>
      validateJsonValue(item, `${path}.${key}`, issues, ancestors),
    );
  } else {
    issues.push(`${path}: must be a plain JSON object`);
  }
  ancestors.delete(value);
}

function requireRecord(value: unknown, path: string, issues: string[]): JsonRecord | null {
  if (!isRecord(value)) {
    issues.push(`${path}: must be an object`);
    return null;
  }
  return value;
}

function rejectUnknownKeys(
  record: JsonRecord,
  allowed: readonly string[],
  path: string,
  issues: string[],
): void {
  const allowedSet = new Set(allowed);
  Object.keys(record).forEach((key) => {
    if (!allowedSet.has(key)) issues.push(`${path}.${key}: unknown field`);
  });
}

function requireString(
  record: JsonRecord,
  key: string,
  path: string,
  issues: string[],
  allowEmpty = false,
): void {
  const value = record[key];
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    issues.push(`${path}.${key}: must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  }
}

function optionalString(record: JsonRecord, key: string, path: string, issues: string[]): void {
  if (record[key] !== undefined && typeof record[key] !== 'string') {
    issues.push(`${path}.${key}: must be a string when present`);
  }
}

function requireBoolean(record: JsonRecord, key: string, path: string, issues: string[]): void {
  if (typeof record[key] !== 'boolean') issues.push(`${path}.${key}: must be a boolean`);
}

function requireNumber(
  record: JsonRecord,
  key: string,
  path: string,
  issues: string[],
  options: { min?: number; max?: number; integer?: boolean } = {},
): void {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(`${path}.${key}: must be a finite number`);
    return;
  }
  if (options.integer && !Number.isInteger(value)) issues.push(`${path}.${key}: must be an integer`);
  if (options.min !== undefined && value < options.min) {
    issues.push(`${path}.${key}: must be >= ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    issues.push(`${path}.${key}: must be <= ${options.max}`);
  }
}

function optionalNumber(
  record: JsonRecord,
  key: string,
  path: string,
  issues: string[],
  options: { min?: number; max?: number; integer?: boolean } = {},
): void {
  if (record[key] !== undefined) requireNumber(record, key, path, issues, options);
}

function requireEnum(
  record: JsonRecord,
  key: string,
  values: readonly string[],
  path: string,
  issues: string[],
): void {
  if (typeof record[key] !== 'string' || !values.includes(record[key] as string)) {
    issues.push(`${path}.${key}: unsupported value`);
  }
}

function optionalEnum(
  record: JsonRecord,
  key: string,
  values: readonly string[],
  path: string,
  issues: string[],
): void {
  if (record[key] !== undefined) requireEnum(record, key, values, path, issues);
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function requireDate(record: JsonRecord, key: string, path: string, issues: string[]): void {
  if (!isDateOnly(record[key])) issues.push(`${path}.${key}: must be a valid YYYY-MM-DD date`);
}

function optionalDate(record: JsonRecord, key: string, path: string, issues: string[]): void {
  if (record[key] !== undefined) requireDate(record, key, path, issues);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

function requireTimestamp(record: JsonRecord, key: string, path: string, issues: string[]): void {
  if (!isTimestamp(record[key])) issues.push(`${path}.${key}: must be a valid timestamp`);
}

function validateStringArray(value: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push(`${path}: must be an array`);
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') issues.push(`${path}[${index}]: must be a string`);
  });
}

function validateInstrument(value: unknown, path: string, issues: string[]): void {
  const item = requireRecord(value, path, issues);
  if (!item) return;
  rejectUnknownKeys(
    item,
    [
      'id', 'symbol', 'name', 'market', 'currency', 'dividendEligible', 'securityType',
      'extraWithholdingRate', 'dividendOption', 'custodyChannel', 'goldForm', 'spreadRate',
      'dataSourceOverride', 'closed', 'tags',
    ],
    path,
    issues,
  );
  requireString(item, 'id', path, issues);
  requireString(item, 'symbol', path, issues);
  requireString(item, 'name', path, issues);
  requireEnum(item, 'market', MARKETS, path, issues);
  requireEnum(item, 'currency', CURRENCIES, path, issues);
  requireBoolean(item, 'dividendEligible', path, issues);
  requireEnum(item, 'securityType', SECURITY_TYPES, path, issues);
  requireNumber(item, 'extraWithholdingRate', path, issues, { min: 0, max: 1 });
  optionalEnum(item, 'dividendOption', DIVIDEND_OPTIONS, path, issues);
  requireEnum(item, 'custodyChannel', CUSTODY_CHANNELS, path, issues);
  optionalEnum(item, 'goldForm', GOLD_FORMS, path, issues);
  optionalNumber(item, 'spreadRate', path, issues, { min: 0 });
  optionalString(item, 'dataSourceOverride', path, issues);
  if (item.closed !== undefined && typeof item.closed !== 'boolean') {
    issues.push(`${path}.closed: must be a boolean when present`);
  }
  if (item.tags !== undefined) validateStringArray(item.tags, `${path}.tags`, issues);
}

function validateTransaction(value: unknown, path: string, issues: string[]): void {
  const item = requireRecord(value, path, issues);
  if (!item) return;
  rejectUnknownKeys(
    item,
    [
      'id', 'instrumentId', 'type', 'status', 'date', 'quantity', 'price', 'amount', 'fee',
      'currency', 'fxRate', 'note', 'source', 'meta',
    ],
    path,
    issues,
  );
  requireString(item, 'id', path, issues);
  requireString(item, 'instrumentId', path, issues);
  requireEnum(item, 'type', TRANSACTION_TYPES, path, issues);
  requireEnum(item, 'status', TRANSACTION_STATUSES, path, issues);
  requireDate(item, 'date', path, issues);
  requireNumber(item, 'quantity', path, issues);
  requireNumber(item, 'price', path, issues, { min: 0 });
  requireNumber(item, 'amount', path, issues, { min: 0 });
  optionalNumber(item, 'fee', path, issues, { min: 0 });
  requireEnum(item, 'currency', CURRENCIES, path, issues);
  requireNumber(item, 'fxRate', path, issues, { min: Number.MIN_VALUE });
  optionalString(item, 'note', path, issues);
  optionalEnum(item, 'source', TRANSACTION_SOURCES, path, issues);
  if (item.meta !== undefined && !isRecord(item.meta)) {
    issues.push(`${path}.meta: must be a JSON object when present`);
  }
}

function validatePlan(value: unknown, path: string, issues: string[]): void {
  const item = requireRecord(value, path, issues);
  if (!item) return;
  rejectUnknownKeys(
    item,
    [
      'id', 'instrumentId', 'amount', 'frequency', 'executionDay', 'startDate', 'endDate',
      'holidayPolicy', 'monthEndPolicy', 'autoConfirm', 'status', 'nextRunDate',
    ],
    path,
    issues,
  );
  requireString(item, 'id', path, issues);
  requireString(item, 'instrumentId', path, issues);
  requireNumber(item, 'amount', path, issues, { min: Number.MIN_VALUE });
  requireEnum(item, 'frequency', PLAN_FREQUENCIES, path, issues);
  requireNumber(item, 'executionDay', path, issues, { min: 0, max: 31, integer: true });
  requireDate(item, 'startDate', path, issues);
  optionalDate(item, 'endDate', path, issues);
  requireEnum(item, 'holidayPolicy', HOLIDAY_POLICIES, path, issues);
  requireEnum(item, 'monthEndPolicy', ['LAST_TRADING_DAY'], path, issues);
  requireBoolean(item, 'autoConfirm', path, issues);
  requireEnum(item, 'status', PLAN_STATUSES, path, issues);
  optionalDate(item, 'nextRunDate', path, issues);
}

function validateDividend(value: unknown, path: string, issues: string[]): void {
  const item = requireRecord(value, path, issues);
  if (!item) return;
  rejectUnknownKeys(
    item,
    [
      'id', 'instrumentId', 'status', 'announceDate', 'recordDate', 'exDate', 'payDate',
      'payDateEstimated', 'perShareAmount', 'currency', 'quantityAtRecord', 'grossAmount',
      'taxRateApplied', 'taxWithheld', 'contingentTax', 'netAmount', 'actualReceived',
      'deviationPct', 'taxBracket', 'daysToZeroTax', 'dividendForm', 'isSpecial',
      'isEstimate', 'manual', 'sourceKey', 'taxWithheldOverride',
    ],
    path,
    issues,
  );
  requireString(item, 'id', path, issues);
  requireString(item, 'instrumentId', path, issues);
  requireEnum(item, 'status', DIVIDEND_STATUSES, path, issues);
  optionalDate(item, 'announceDate', path, issues);
  optionalDate(item, 'recordDate', path, issues);
  optionalDate(item, 'exDate', path, issues);
  optionalDate(item, 'payDate', path, issues);
  requireBoolean(item, 'payDateEstimated', path, issues);
  requireNumber(item, 'perShareAmount', path, issues, { min: 0 });
  requireEnum(item, 'currency', CURRENCIES, path, issues);
  requireNumber(item, 'quantityAtRecord', path, issues, { min: 0 });
  requireNumber(item, 'grossAmount', path, issues, { min: 0 });
  requireNumber(item, 'taxRateApplied', path, issues, { min: 0, max: 1 });
  requireNumber(item, 'taxWithheld', path, issues, { min: 0 });
  requireNumber(item, 'contingentTax', path, issues, { min: 0 });
  requireNumber(item, 'netAmount', path, issues, { min: 0 });
  optionalNumber(item, 'actualReceived', path, issues, { min: 0 });
  optionalNumber(item, 'deviationPct', path, issues);
  requireEnum(item, 'taxBracket', TAX_BRACKETS, path, issues);
  optionalNumber(item, 'daysToZeroTax', path, issues, { min: 0, integer: true });
  requireEnum(item, 'dividendForm', DIVIDEND_FORMS, path, issues);
  if (item.isSpecial !== undefined && typeof item.isSpecial !== 'boolean') {
    issues.push(`${path}.isSpecial: must be a boolean when present`);
  }
  if (item.isEstimate !== undefined && typeof item.isEstimate !== 'boolean') {
    issues.push(`${path}.isEstimate: must be a boolean when present`);
  }
  requireBoolean(item, 'manual', path, issues);
  requireString(item, 'sourceKey', path, issues);
  optionalNumber(item, 'taxWithheldOverride', path, issues, { min: 0 });
}

function validateNotification(value: unknown, path: string, issues: string[]): void {
  const item = requireRecord(value, path, issues);
  if (!item) return;
  rejectUnknownKeys(
    item,
    [
      'id', 'key', 'type', 'title', 'body', 'severity', 'createdAt', 'read',
      'relatedInstrumentId',
    ],
    path,
    issues,
  );
  requireString(item, 'id', path, issues);
  requireString(item, 'key', path, issues);
  requireEnum(item, 'type', NOTIFICATION_TYPES, path, issues);
  requireString(item, 'title', path, issues, true);
  requireString(item, 'body', path, issues, true);
  requireEnum(item, 'severity', SEVERITIES, path, issues);
  requireTimestamp(item, 'createdAt', path, issues);
  requireBoolean(item, 'read', path, issues);
  optionalString(item, 'relatedInstrumentId', path, issues);
}

function validateSettings(value: unknown, path: string, issues: string[]): void {
  const settings = requireRecord(value, path, issues);
  if (!settings) return;
  rejectUnknownKeys(
    settings,
    [
      'baseCurrency', 'displayCurrency', 'colorScheme', 'w8benFilled', 'fxNeutralMode',
      'annualIncomeTarget', 'notificationChannels', 'quietHours', 'stalenessThresholdHours',
    ],
    path,
    issues,
  );
  requireEnum(settings, 'baseCurrency', ['CNY', 'USD'], path, issues);
  requireEnum(settings, 'displayCurrency', CURRENCIES, path, issues);
  requireEnum(settings, 'colorScheme', COLOR_SCHEMES, path, issues);
  requireBoolean(settings, 'w8benFilled', path, issues);
  requireBoolean(settings, 'fxNeutralMode', path, issues);
  optionalNumber(settings, 'annualIncomeTarget', path, issues, { min: 0 });
  requireNumber(settings, 'stalenessThresholdHours', path, issues, { min: 0 });

  const channels = requireRecord(settings.notificationChannels, `${path}.notificationChannels`, issues);
  if (channels) {
    rejectUnknownKeys(channels, ['telegram', 'feishu', 'wecom'], `${path}.notificationChannels`, issues);
    optionalString(channels, 'telegram', `${path}.notificationChannels`, issues);
    optionalString(channels, 'feishu', `${path}.notificationChannels`, issues);
    optionalString(channels, 'wecom', `${path}.notificationChannels`, issues);
  }

  if (settings.quietHours !== undefined) {
    const quiet = requireRecord(settings.quietHours, `${path}.quietHours`, issues);
    if (quiet) {
      rejectUnknownKeys(quiet, ['start', 'end'], `${path}.quietHours`, issues);
      requireString(quiet, 'start', `${path}.quietHours`, issues);
      requireString(quiet, 'end', `${path}.quietHours`, issues);
    }
  }
}

function validateArray(
  value: unknown,
  path: string,
  issues: string[],
  validateItem: (item: unknown, itemPath: string, itemIssues: string[]) => void,
  identity: (item: JsonRecord) => unknown,
): void {
  if (!Array.isArray(value)) {
    issues.push(`${path}: must be an array`);
    return;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    validateItem(item, `${path}[${index}]`, issues);
    if (!isRecord(item)) return;
    const rawKey = identity(item);
    if (typeof rawKey !== 'string' || rawKey.trim() === '') return;
    if (seen.has(rawKey)) issues.push(`${path}[${index}]: duplicate key ${JSON.stringify(rawKey)}`);
    seen.add(rawKey);
  });
}

/**
 * Runtime trust boundary for data returned by CloudBase/localStorage.
 * It never throws. Unsupported schemas are rejected instead of being guessed.
 */
export function parseLedgerPayload(input: unknown): ParseResult<LedgerPayload> {
  const parsed = parseUnknownInput(input);
  if (!parsed.ok) return parsed;
  const issues: string[] = [];
  validateJsonValue(parsed.value, 'payload', issues, new Set());
  const payload = requireRecord(parsed.value, 'payload', issues);
  if (!payload) return { ok: false, issues: unique(issues) };
  rejectUnknownKeys(payload, LEDGER_KEYS, 'payload', issues);

  if (payload.schemaVersion !== 1) {
    issues.push('payload.schemaVersion: unsupported schema (expected 1)');
  }
  validateArray(payload.instruments, 'payload.instruments', issues, validateInstrument, (item) => item.id);
  validateArray(payload.transactions, 'payload.transactions', issues, validateTransaction, (item) => item.id);
  validateArray(payload.plans, 'payload.plans', issues, validatePlan, (item) => item.id);
  validateArray(payload.dividends, 'payload.dividends', issues, validateDividend, (item) => item.id);
  validateArray(payload.notifications, 'payload.notifications', issues, validateNotification, (item) => item.key);
  validateSettings(payload.settings, 'payload.settings', issues);
  requireTimestamp(payload, 'updatedAt', 'payload', issues);

  if (issues.length > 0) return { ok: false, issues: unique(issues) };
  return { ok: true, value: parsed.value as LedgerPayload };
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareIdentity<T>(identity: (item: T) => string) {
  return (left: T, right: T): number => compareText(identity(left), identity(right));
}

function stableClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stableClone(item)) as T;
  if (isRecord(value)) {
    const result: JsonRecord = {};
    Object.keys(value)
      .sort(compareText)
      .forEach((key) => {
        result[key] = stableClone(value[key]);
      });
    return result as T;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableClone(value));
}

function mergeNotificationDuplicates(notifications: Notification[]): Notification[] {
  const merged = new Map<string, Notification>();
  notifications.forEach((notification) => {
    const existing = merged.get(notification.key);
    if (!existing) {
      merged.set(notification.key, notification);
      return;
    }
    const newer = Date.parse(notification.createdAt) >= Date.parse(existing.createdAt)
      ? notification
      : existing;
    merged.set(notification.key, { ...newer, read: existing.read || notification.read });
  });
  return [...merged.values()];
}

/** Sorts set-like arrays and recursively orders object keys without mutating the input. */
export function canonicalizeLedgerPayload(payload: LedgerPayload): LedgerPayload {
  return stableClone({
    ...payload,
    instruments: [...payload.instruments].sort(compareIdentity((item) => item.id)),
    transactions: [...payload.transactions].sort(compareIdentity((item) => item.id)),
    plans: [...payload.plans].sort(compareIdentity((item) => item.id)),
    dividends: [...payload.dividends].sort(compareIdentity((item) => item.id)),
    notifications: mergeNotificationDuplicates(payload.notifications)
      .sort(compareIdentity((item) => `${item.key}\u0000${item.id}`)),
  });
}

/**
 * Canonical semantic JSON for dirty checks. updatedAt is deliberately excluded.
 * Generated notifications are device-local projections; durable notifications are synced.
 */
export function canonicalLedgerJson(payload: LedgerPayload): string {
  const canonical = canonicalizeLedgerPayload(payload);
  return stableStringify({
    schemaVersion: canonical.schemaVersion,
    instruments: canonical.instruments,
    transactions: canonical.transactions,
    plans: canonical.plans,
    dividends: canonical.dividends,
    // Manual/system durable notifications are real ledger records, including when unread.
    // gen-* notifications are rebuilt from market data and may disappear as dates roll
    // forward. Persisting them can otherwise hold first hydration open forever.
    durableNotifications: canonical.notifications
      .filter((notification) => !notification.id.startsWith('gen-')),
    settings: canonical.settings,
  });
}

function fnv1a32(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Stable, non-cryptographic content fingerprint. Never use it as an auth/security primitive. */
export function ledgerFingerprint(payload: LedgerPayload): string {
  const canonical = canonicalLedgerJson(payload);
  return `ledger-v1-${canonical.length.toString(36)}-${fnv1a32(canonical, 0x811c9dc5)}-${fnv1a32(canonical, 0x9e3779b9)}`;
}

function comparePayloadPriority(
  local: LedgerPayload,
  remote: LedgerPayload,
  options: MergeLedgerOptions,
): 'local' | 'remote' {
  if (
    options.localRevision !== undefined &&
    options.remoteRevision !== undefined &&
    options.localRevision !== options.remoteRevision
  ) {
    return options.localRevision > options.remoteRevision ? 'local' : 'remote';
  }
  const localTime = Date.parse(local.updatedAt);
  const remoteTime = Date.parse(remote.updatedAt);
  if (localTime !== remoteTime) return localTime > remoteTime ? 'local' : 'remote';
  return options.prefer ?? 'remote';
}

function mergeByKey<T>(
  slice: Exclude<LedgerSlice, 'notifications' | 'settings'>,
  localItems: T[],
  remoteItems: T[],
  keyOf: (item: T) => string,
  winner: 'local' | 'remote',
  conflicts: LedgerMergeConflict[],
): T[] {
  const localByKey = new Map(localItems.map((item) => [keyOf(item), item]));
  const remoteByKey = new Map(remoteItems.map((item) => [keyOf(item), item]));
  const keys = [...new Set([...localByKey.keys(), ...remoteByKey.keys()])]
    .sort(compareText);

  return keys.map((key) => {
    const local = localByKey.get(key);
    const remote = remoteByKey.get(key);
    if (local === undefined) return remote as T;
    if (remote === undefined) return local;
    if (stableStringify(local) !== stableStringify(remote)) {
      conflicts.push({ slice, key, winner });
    }
    return winner === 'local' ? local : remote;
  });
}

function mergeNotifications(
  localItems: Notification[],
  remoteItems: Notification[],
  winner: 'local' | 'remote',
  conflicts: LedgerMergeConflict[],
): Notification[] {
  const localByKey = new Map(mergeNotificationDuplicates(localItems).map((item) => [item.key, item]));
  const remoteByKey = new Map(mergeNotificationDuplicates(remoteItems).map((item) => [item.key, item]));
  const keys = [...new Set([...localByKey.keys(), ...remoteByKey.keys()])]
    .sort(compareText);

  return keys.map((key) => {
    const local = localByKey.get(key);
    const remote = remoteByKey.get(key);
    if (!local) return remote as Notification;
    if (!remote) return local;
    if (stableStringify(local) !== stableStringify(remote)) {
      conflicts.push({ slice: 'notifications', key, winner });
    }
    const chosen = winner === 'local' ? local : remote;
    return { ...chosen, read: local.read || remote.read };
  });
}

function hasCurrencyBoundRecords(payload: LedgerPayload): boolean {
  return payload.transactions.length > 0 || payload.dividends.length > 0;
}

function currencyBoundByTwoWayMerge(
  local: LedgerPayload,
  remote: LedgerPayload,
  fallback: AppSettings['baseCurrency'],
): AppSettings['baseCurrency'] {
  const localBound = hasCurrencyBoundRecords(local);
  const remoteBound = hasCurrencyBoundRecords(remote);
  if (
    localBound &&
    remoteBound &&
    local.settings.baseCurrency !== remote.settings.baseCurrency
  ) {
    throw new Error('账本本位币冲突：两端已有按不同本位币记入的金额，已停止自动合并');
  }
  if (localBound) return local.settings.baseCurrency;
  if (remoteBound) return remote.settings.baseCurrency;
  return fallback;
}

function currencyBoundByThreeWayMerge(
  base: LedgerPayload,
  local: LedgerPayload,
  remote: LedgerPayload,
  mergedTransactions: Transaction[],
  mergedDividends: DividendEvent[],
  fallback: AppSettings['baseCurrency'],
): AppSettings['baseCurrency'] {
  // Once all financial records have deliberately been removed, changing the
  // base currency is safe again.
  if (mergedTransactions.length === 0 && mergedDividends.length === 0) return fallback;
  if (hasCurrencyBoundRecords(base)) return base.settings.baseCurrency;

  const localBound = hasCurrencyBoundRecords(local);
  const remoteBound = hasCurrencyBoundRecords(remote);
  if (
    localBound &&
    remoteBound &&
    local.settings.baseCurrency !== remote.settings.baseCurrency
  ) {
    throw new Error('账本本位币冲突：两台设备首次记账时使用了不同本位币，已停止自动合并');
  }
  if (localBound) return local.settings.baseCurrency;
  if (remoteBound) return remote.settings.baseCurrency;
  return fallback;
}

/**
 * Conservative merge for the current schema (which has no per-item revisions or tombstones).
 * Distinct IDs are always retained. Same-ID conflicts use payload revision, then updatedAt,
 * then the explicit preference. This avoids silent loss but can resurrect a concurrent delete.
 */
export function mergeLedgerPayloads(
  local: LedgerPayload,
  remote: LedgerPayload,
  options: MergeLedgerOptions = {},
): MergeLedgerResult {
  const conflicts: LedgerMergeConflict[] = [];
  const winner = comparePayloadPriority(local, remote, options);
  const settingsEqual = stableStringify(local.settings) === stableStringify(remote.settings);
  if (!settingsEqual) conflicts.push({ slice: 'settings', key: 'settings', winner });

  const instruments = mergeByKey(
      'instruments', local.instruments, remote.instruments, (item) => item.id, winner, conflicts,
    );
  const transactions = mergeByKey(
      'transactions', local.transactions, remote.transactions, (item) => item.id, winner, conflicts,
    );
  const plans = mergeByKey('plans', local.plans, remote.plans, (item) => item.id, winner, conflicts);
  const dividends = mergeByKey(
      'dividends', local.dividends, remote.dividends, (item) => item.id, winner, conflicts,
    );
  const notifications = mergeNotifications(local.notifications, remote.notifications, winner, conflicts);
  const winningSettings = winner === 'local' ? local.settings : remote.settings;
  const baseCurrency = currencyBoundByTwoWayMerge(local, remote, winningSettings.baseCurrency);

  const payload: LedgerPayload = {
    schemaVersion: 1,
    instruments,
    transactions,
    plans,
    dividends,
    notifications,
    settings: { ...winningSettings, baseCurrency },
    updatedAt: Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt)
      ? local.updatedAt
      : remote.updatedAt,
  };

  return { payload: canonicalizeLedgerPayload(payload), conflicts, winner };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return stableStringify(left) === stableStringify(right);
}

function mergeByKeyThreeWay<T>(
  slice: Exclude<LedgerSlice, 'settings'>,
  baseItems: T[],
  localItems: T[],
  remoteItems: T[],
  keyOf: (item: T) => string,
  winner: 'local' | 'remote',
  conflicts: LedgerMergeConflict[],
): T[] {
  const baseByKey = new Map(baseItems.map((item) => [keyOf(item), item]));
  const localByKey = new Map(localItems.map((item) => [keyOf(item), item]));
  const remoteByKey = new Map(remoteItems.map((item) => [keyOf(item), item]));
  const keys = [...new Set([...baseByKey.keys(), ...localByKey.keys(), ...remoteByKey.keys()])]
    .sort(compareText);
  const merged: T[] = [];

  keys.forEach((key) => {
    const base = baseByKey.get(key);
    const local = localByKey.get(key);
    const remote = remoteByKey.get(key);
    let chosen: T | undefined;

    if (sameValue(local, remote)) chosen = local;
    else if (sameValue(local, base)) chosen = remote;
    else if (sameValue(remote, base)) chosen = local;
    else if (local === undefined || remote === undefined) {
      // A delete racing with an edit is deliberately delete-wins. Restoring a deleted
      // financial record silently is more surprising than surfacing the reported conflict.
      chosen = undefined;
      conflicts.push({ slice, key, winner: local === undefined ? 'local' : 'remote' });
    } else {
      chosen = winner === 'local' ? local : remote;
      conflicts.push({ slice, key, winner });
    }

    if (chosen !== undefined) merged.push(chosen);
  });
  return merged;
}

function durableNotifications(items: Notification[]): Notification[] {
  return mergeNotificationDuplicates(items.filter((item) => !item.id.startsWith('gen-')));
}

function mergeNotificationsThreeWay(
  baseItems: Notification[],
  localItems: Notification[],
  remoteItems: Notification[],
  winner: 'local' | 'remote',
  conflicts: LedgerMergeConflict[],
): Notification[] {
  const merged = mergeByKeyThreeWay(
    'notifications',
    durableNotifications(baseItems),
    durableNotifications(localItems),
    durableNotifications(remoteItems),
    (item) => item.key,
    winner,
    conflicts,
  );
  const localByKey = new Map(localItems.map((item) => [item.key, item]));
  const remoteByKey = new Map(remoteItems.map((item) => [item.key, item]));
  return merged.map((item) => ({
    ...item,
    read: Boolean(localByKey.get(item.key)?.read || remoteByKey.get(item.key)?.read),
  }));
}

/**
 * True three-way merge from an exact clean base. Local/remote additions are retained,
 * intentional deletion is propagated, and delete-vs-edit conflicts use delete-wins.
 */
export function mergeLedgerPayloadsThreeWay(
  base: LedgerPayload,
  local: LedgerPayload,
  remote: LedgerPayload,
  options: MergeLedgerOptions = {},
): MergeLedgerResult {
  const conflicts: LedgerMergeConflict[] = [];
  const winner = comparePayloadPriority(local, remote, options);
  const selectedSettings = sameValue(local.settings, remote.settings)
    ? local.settings
    : sameValue(local.settings, base.settings)
      ? remote.settings
      : sameValue(remote.settings, base.settings)
        ? local.settings
        : winner === 'local'
          ? local.settings
          : remote.settings;
  if (
    !sameValue(local.settings, remote.settings) &&
    !sameValue(local.settings, base.settings) &&
    !sameValue(remote.settings, base.settings)
  ) {
    conflicts.push({ slice: 'settings', key: 'settings', winner });
  }

  const instruments = mergeByKeyThreeWay(
      'instruments', base.instruments, local.instruments, remote.instruments,
      (item) => item.id, winner, conflicts,
    );
  const transactions = mergeByKeyThreeWay(
      'transactions', base.transactions, local.transactions, remote.transactions,
      (item) => item.id, winner, conflicts,
    );
  const plans = mergeByKeyThreeWay(
      'plans', base.plans, local.plans, remote.plans,
      (item) => item.id, winner, conflicts,
    );
  const dividends = mergeByKeyThreeWay(
      'dividends', base.dividends, local.dividends, remote.dividends,
      (item) => item.id, winner, conflicts,
    );
  const notifications = mergeNotificationsThreeWay(
      base.notifications, local.notifications, remote.notifications, winner, conflicts,
    );
  const baseCurrency = currencyBoundByThreeWayMerge(
    base,
    local,
    remote,
    transactions,
    dividends,
    selectedSettings.baseCurrency,
  );

  const payload: LedgerPayload = {
    schemaVersion: 1,
    instruments,
    transactions,
    plans,
    dividends,
    notifications,
    settings: { ...selectedSettings, baseCurrency },
    updatedAt: Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt)
      ? local.updatedAt
      : remote.updatedAt,
  };

  return { payload: canonicalizeLedgerPayload(payload), conflicts, winner };
}

function validateRevision(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    issues.push(`${path}: must be a non-negative safe integer`);
  }
}

export function createSyncOutbox(input: CreateSyncOutboxInput): SyncOutboxEntry {
  const ownerUid = input.ownerUid.trim();
  if (!ownerUid) throw new Error('ownerUid must be non-empty');
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new Error('baseRevision must be a non-negative safe integer');
  }
  const parsed = parseLedgerPayload(input.payload);
  if (!parsed.ok) throw new Error(`invalid ledger payload: ${parsed.issues.join('; ')}`);
  const parsedBase = input.basePayload ? parseLedgerPayload(input.basePayload) : null;
  if (parsedBase && !parsedBase.ok) {
    throw new Error(`invalid base ledger payload: ${parsedBase.issues.join('; ')}`);
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!isTimestamp(createdAt)) throw new Error('createdAt must be a valid timestamp');
  const payload = canonicalizeLedgerPayload(parsed.value);
  const basePayload = parsedBase?.ok ? canonicalizeLedgerPayload(parsedBase.value) : undefined;
  const baseFingerprint = basePayload
    ? ledgerFingerprint(basePayload)
    : input.baseFingerprint;
  if (
    basePayload &&
    input.baseFingerprint &&
    input.baseFingerprint !== baseFingerprint
  ) {
    throw new Error('baseFingerprint does not match basePayload');
  }
  return {
    version: 1,
    ownerUid,
    baseRevision: input.baseRevision,
    ...(baseFingerprint ? { baseFingerprint } : {}),
    ...(basePayload ? { basePayload } : {}),
    payload,
    fingerprint: ledgerFingerprint(payload),
    createdAt,
  };
}

export function parseSyncOutbox(input: unknown): ParseResult<SyncOutboxEntry> {
  const parsed = parseUnknownInput(input);
  if (!parsed.ok) return parsed;
  const issues: string[] = [];
  validateJsonValue(parsed.value, 'outbox', issues, new Set());
  const outbox = requireRecord(parsed.value, 'outbox', issues);
  if (!outbox) return { ok: false, issues: unique(issues) };
  rejectUnknownKeys(
    outbox,
    [
      'version', 'ownerUid', 'baseRevision', 'baseFingerprint', 'basePayload',
      'payload', 'fingerprint', 'createdAt',
    ],
    'outbox',
    issues,
  );
  if (outbox.version !== 1) issues.push('outbox.version: unsupported schema (expected 1)');
  requireString(outbox, 'ownerUid', 'outbox', issues);
  validateRevision(outbox.baseRevision, 'outbox.baseRevision', issues);
  if (outbox.baseFingerprint !== undefined) {
    requireString(outbox, 'baseFingerprint', 'outbox', issues);
  }
  requireString(outbox, 'fingerprint', 'outbox', issues);
  requireTimestamp(outbox, 'createdAt', 'outbox', issues);
  const payloadResult = parseLedgerPayload(outbox.payload);
  const basePayloadResult = outbox.basePayload === undefined
    ? null
    : parseLedgerPayload(outbox.basePayload);
  if (!payloadResult.ok) {
    issues.push(...payloadResult.issues.map((issue) => `outbox.${issue}`));
  } else if (outbox.fingerprint !== ledgerFingerprint(payloadResult.value)) {
    issues.push('outbox.fingerprint: does not match payload');
  }
  if (basePayloadResult && !basePayloadResult.ok) {
    issues.push(...basePayloadResult.issues.map((issue) => `outbox.base.${issue}`));
  } else if (
    basePayloadResult?.ok &&
    outbox.baseFingerprint !== ledgerFingerprint(basePayloadResult.value)
  ) {
    issues.push('outbox.baseFingerprint: does not match basePayload');
  }
  if (issues.length > 0 || !payloadResult.ok || basePayloadResult?.ok === false) {
    return { ok: false, issues: unique(issues) };
  }
  return {
    ok: true,
    value: {
      version: 1,
      ownerUid: (outbox.ownerUid as string).trim(),
      baseRevision: outbox.baseRevision as number,
      ...(outbox.baseFingerprint
        ? { baseFingerprint: outbox.baseFingerprint as string }
        : {}),
      ...(basePayloadResult?.ok
        ? { basePayload: canonicalizeLedgerPayload(basePayloadResult.value) }
        : {}),
      payload: canonicalizeLedgerPayload(payloadResult.value),
      fingerprint: outbox.fingerprint as string,
      createdAt: outbox.createdAt as string,
    },
  };
}

/** Builds a user-bound local cache so one account can never hydrate from another account's state. */
export function createLedgerOwnerCache(
  ownerUidValue: string,
  payloadValue: LedgerPayload,
  savedAtValue = new Date().toISOString(),
): LedgerOwnerCache {
  const ownerUid = ownerUidValue.trim();
  if (!ownerUid) throw new Error('ownerUid must be non-empty');
  const parsed = parseLedgerPayload(payloadValue);
  if (!parsed.ok) throw new Error(`invalid ledger payload: ${parsed.issues.join('; ')}`);
  if (!isTimestamp(savedAtValue)) throw new Error('savedAt must be a valid timestamp');
  const payload = canonicalizeLedgerPayload(parsed.value);
  return {
    version: 1,
    ownerUid,
    payload,
    fingerprint: ledgerFingerprint(payload),
    savedAt: savedAtValue,
  };
}

export function parseLedgerOwnerCache(input: unknown): ParseResult<LedgerOwnerCache> {
  const parsed = parseUnknownInput(input);
  if (!parsed.ok) return parsed;
  const issues: string[] = [];
  validateJsonValue(parsed.value, 'cache', issues, new Set());
  const cache = requireRecord(parsed.value, 'cache', issues);
  if (!cache) return { ok: false, issues: unique(issues) };
  rejectUnknownKeys(cache, ['version', 'ownerUid', 'payload', 'fingerprint', 'savedAt'], 'cache', issues);
  if (cache.version !== 1) issues.push('cache.version: unsupported schema (expected 1)');
  requireString(cache, 'ownerUid', 'cache', issues);
  requireString(cache, 'fingerprint', 'cache', issues);
  requireTimestamp(cache, 'savedAt', 'cache', issues);
  const payloadResult = parseLedgerPayload(cache.payload);
  if (!payloadResult.ok) {
    issues.push(...payloadResult.issues.map((issue) => `cache.${issue}`));
  } else if (cache.fingerprint !== ledgerFingerprint(payloadResult.value)) {
    issues.push('cache.fingerprint: does not match payload');
  }
  if (issues.length > 0 || !payloadResult.ok) return { ok: false, issues: unique(issues) };
  return {
    ok: true,
    value: {
      version: 1,
      ownerUid: (cache.ownerUid as string).trim(),
      payload: canonicalizeLedgerPayload(payloadResult.value),
      fingerprint: cache.fingerprint as string,
      savedAt: cache.savedAt as string,
    },
  };
}

/**
 * Decides whether initial remote hydration is safe. A matching-owner outbox or a local
 * fingerprint diverging from the known base is treated as dirty and merged, never replaced.
 */
export function decideHydration(input: DecideHydrationInput): HydrationDecision {
  const ownerUid = input.ownerUid.trim();
  if (input.outbox && input.outbox.ownerUid !== ownerUid) {
    return {
      mode: 'BLOCK',
      reason: 'OUTBOX_OWNER_MISMATCH',
      outboxOwnerUid: input.outbox.ownerUid,
    };
  }

  const localFingerprint = ledgerFingerprint(input.local);
  const remoteFingerprint = input.remote ? ledgerFingerprint(input.remote) : null;
  const dirtyByOutbox = Boolean(input.outbox);
  const dirtySinceBase = Boolean(
    input.knownBaseFingerprint && localFingerprint !== input.knownBaseFingerprint,
  );

  if (!input.remote) {
    return {
      mode: 'KEEP_LOCAL',
      payload: canonicalizeLedgerPayload(input.outbox?.payload ?? input.local),
      shouldUpload: dirtyByOutbox || dirtySinceBase,
      reason: 'NO_REMOTE',
    };
  }

  if (input.outbox && input.outbox.fingerprint === remoteFingerprint) {
    return {
      mode: 'APPLY_REMOTE',
      payload: canonicalizeLedgerPayload(input.remote),
      clearOutbox: true,
      reason: 'REMOTE_ALREADY_CONTAINS_LOCAL',
    };
  }

  if (!input.outbox && localFingerprint === remoteFingerprint) {
    return {
      mode: 'KEEP_LOCAL',
      payload: canonicalizeLedgerPayload(input.local),
      shouldUpload: false,
      reason: 'ALREADY_EQUAL',
    };
  }

  // The cloud ledger is still exactly the version on which the local edit was based.
  // In this case the outbox is authoritative as a complete snapshot, including deletions;
  // a set-union merge would incorrectly resurrect records the user just removed.
  if (
    input.outbox?.baseFingerprint &&
    input.outbox.baseFingerprint === remoteFingerprint
  ) {
    return {
      mode: 'KEEP_LOCAL',
      payload: canonicalizeLedgerPayload(input.outbox.payload),
      shouldUpload: true,
      reason: 'REMOTE_UNCHANGED_SINCE_BASE',
    };
  }

  if (input.outbox?.basePayload) {
    const merge = mergeLedgerPayloadsThreeWay(
      input.outbox.basePayload,
      input.outbox.payload,
      input.remote,
      {
        localRevision: input.outbox.baseRevision + 1,
        remoteRevision: input.remoteRevision,
        prefer: 'local',
      },
    );
    if (ledgerFingerprint(merge.payload) === remoteFingerprint) {
      return {
        mode: 'APPLY_REMOTE',
        payload: canonicalizeLedgerPayload(input.remote),
        clearOutbox: true,
        reason: 'REMOTE_ALREADY_CONTAINS_LOCAL',
      };
    }
    return {
      mode: 'MERGE',
      payload: merge.payload,
      conflicts: merge.conflicts,
      shouldUpload: true,
      reason: 'DIRTY_OUTBOX',
    };
  }

  if (!dirtyByOutbox && !dirtySinceBase) {
    return {
      mode: 'APPLY_REMOTE',
      payload: canonicalizeLedgerPayload(input.remote),
      clearOutbox: false,
      reason: 'REMOTE_AUTHORITATIVE',
    };
  }

  let dirtyLocal = input.local;
  if (input.outbox) {
    dirtyLocal = mergeLedgerPayloads(input.outbox.payload, input.local, {
      localRevision: input.outbox.baseRevision + 1,
      remoteRevision: input.outbox.baseRevision + 1,
      prefer: 'local',
    }).payload;
  }
  const localRevision = input.outbox ? input.outbox.baseRevision + 1 : undefined;
  const merge = mergeLedgerPayloads(dirtyLocal, input.remote, {
    localRevision,
    remoteRevision: input.remoteRevision,
    prefer: 'local',
  });

  if (ledgerFingerprint(merge.payload) === remoteFingerprint) {
    return {
      mode: 'APPLY_REMOTE',
      payload: canonicalizeLedgerPayload(input.remote),
      clearOutbox: dirtyByOutbox,
      reason: 'REMOTE_ALREADY_CONTAINS_LOCAL',
    };
  }

  return {
    mode: 'MERGE',
    payload: merge.payload,
    conflicts: merge.conflicts,
    shouldUpload: true,
    reason: dirtyByOutbox ? 'DIRTY_OUTBOX' : 'LOCAL_CHANGED_SINCE_BASE',
  };
}

// These aliases keep inferred collection types readable for API consumers.
export type LedgerInstrument = Instrument;
export type LedgerTransaction = Transaction;
export type LedgerPlan = InvestmentPlan;
export type LedgerDividend = DividendEvent;
export type LedgerNotification = Notification;
export type LedgerSettings = AppSettings;

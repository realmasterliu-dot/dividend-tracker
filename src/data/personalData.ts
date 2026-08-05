import {
  Currency,
  CustodyChannel,
  DataState,
  DividendOption,
  GoldForm,
  Instrument,
  InvestmentPlan,
  Market,
  PlanFrequency,
  PlanStatus,
  SecurityType,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@/types';
import { dataUrl } from './realData';
import { seedInstruments } from './seed/instruments.seed';
import { seedPlans } from './seed/plans.seed';
import { seedTransactions } from './seed/transactions.seed';

/**
 * 个人数据接入层 —— 读取用户手工维护的 public/data/holdings.json。
 *
 * 边界约定（与 realData.ts 对称）：
 * - 只负责「个人数据」：instruments / transactions / plans。
 *   市场数据（prices / fx / dividends / sourceHealth）由 realData.loadMarketData() 负责。
 * - holdings.json 是「基线」：用户编辑后提交到仓库即可多设备同步；
 *   浏览器 localStorage 里的运行期编辑作为 overlay 叠加在基线之上（mergePersonalData）。
 * - 防御式解析：文件缺失 / 损坏 / 单条脏数据都不能白屏，一律降级到内置种子。
 * - loadPersonalData 永不抛出，失败以 warnings + source:'seed-fallback' 如实上报。
 */

// ============ 类型 ============

/** 个人数据三切片（DataState 的子集） */
export interface PersonalSlices {
  instruments: Instrument[];
  transactions: Transaction[];
  plans: InvestmentPlan[];
}

export interface PersonalDataBundle extends PersonalSlices {
  /** 加载过程中的降级告警（缺文件 / 格式异常） */
  warnings: string[];
  /** file = 来自 holdings.json；seed-fallback = 文件不可用，用内置种子兜底 */
  source: 'file' | 'seed-fallback';
}

/** localStorage 运行期编辑（可能只覆盖部分切片） */
export type PersonalOverlay = Partial<PersonalSlices> | null | undefined;

/** 导出文件的 schema 版本，便于将来做迁移 */
export const HOLDINGS_VERSION = 1;

const HOLDINGS_FILE = 'holdings.json';

// ============ 解析工具（防御式：文件损坏也不能白屏） ============

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function optBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** 枚举兜底：非法值回落到 fallback */
function asEnum<T extends string>(value: unknown, allowed: readonly string[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value) ? (value as T) : fallback;
}

/** 可选枚举：非法值直接丢弃（保持字段缺省而非写入脏值） */
function optEnum<T extends string>(value: unknown, allowed: readonly string[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value) ? (value as T) : undefined;
}

function isEnum(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function optStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return out.length > 0 ? out : undefined;
}

function optMeta(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? { ...value } : undefined;
}

const CURRENCIES: readonly string[] = ['CNY', 'USD', 'HKD'];
const MARKETS: readonly string[] = ['A_SHARE', 'HK', 'US', 'FUND', 'CRYPTO', 'GOLD'];
const SECURITY_TYPES: readonly string[] = [
  'COMMON',
  'REIT',
  'MLP_PTP',
  'ADR',
  'ETF',
  'FUND',
  'CRYPTO',
  'GOLD',
];
const DIVIDEND_OPTIONS: readonly string[] = ['CASH', 'REINVEST'];
const CUSTODY_CHANNELS: readonly string[] = [
  'CN_BROKER',
  'HK_LOCAL_BROKER',
  'HK_STOCK_CONNECT',
  'US_BROKER',
  'CEX',
  'SGE',
  'PHYSICAL',
];
const GOLD_FORMS: readonly string[] = ['PHYSICAL', 'ACCUMULATION', 'ETF', 'TD', 'XAU'];
const TRANSACTION_TYPES: readonly string[] = [
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
];
const TRANSACTION_STATUSES: readonly string[] = ['CONFIRMED', 'PENDING', 'VOIDED'];
const TRANSACTION_SOURCES: readonly string[] = ['MANUAL', 'DCA', 'IMPORT', 'SYSTEM'];
const PLAN_FREQUENCIES: readonly string[] = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'];
const PLAN_STATUSES: readonly string[] = ['ACTIVE', 'PAUSED', 'ENDED'];
const HOLIDAY_POLICIES: readonly string[] = ['NEXT_TRADING_DAY', 'PREV_TRADING_DAY'];

function asCurrency(value: unknown, fallback: Currency = 'CNY'): Currency {
  return asEnum<Currency>(value, CURRENCIES, fallback);
}

// ============ 归一化（逐切片独立解析，单条脏数据只丢自己） ============

/** holdings.instruments → Instrument[]；缺 id/symbol/name/market/currency 的条目直接跳过 */
export function normalizeInstruments(raw: unknown): Instrument[] {
  if (!Array.isArray(raw)) return [];
  const out: Instrument[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = asString(item.id);
    const symbol = asString(item.symbol);
    const name = asString(item.name);
    if (!id || !symbol || !name) continue;
    if (!isEnum(item.market, MARKETS) || !isEnum(item.currency, CURRENCIES)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const instrument: Instrument = {
      id,
      symbol,
      name,
      market: item.market as Market,
      currency: item.currency as Currency,
      dividendEligible: asBoolean(item.dividendEligible, true),
      securityType: asEnum<SecurityType>(item.securityType, SECURITY_TYPES, 'COMMON'),
      extraWithholdingRate: asNumber(item.extraWithholdingRate, 0),
      custodyChannel: asEnum<CustodyChannel>(item.custodyChannel, CUSTODY_CHANNELS, 'CN_BROKER'),
    };

    const dividendOption = optEnum<DividendOption>(item.dividendOption, DIVIDEND_OPTIONS);
    if (dividendOption) instrument.dividendOption = dividendOption;
    const goldForm = optEnum<GoldForm>(item.goldForm, GOLD_FORMS);
    if (goldForm) instrument.goldForm = goldForm;
    const spreadRate = optNumber(item.spreadRate);
    if (spreadRate !== undefined) instrument.spreadRate = spreadRate;
    const dataSourceOverride = optString(item.dataSourceOverride);
    if (dataSourceOverride) instrument.dataSourceOverride = dataSourceOverride;
    const closed = optBoolean(item.closed);
    if (closed !== undefined) instrument.closed = closed;
    const tags = optStringArray(item.tags);
    if (tags) instrument.tags = tags;

    out.push(instrument);
  }
  return out;
}

/** holdings.transactions → Transaction[]；缺 id/instrumentId/type/date 的条目直接跳过 */
export function normalizeTransactions(raw: unknown): Transaction[] {
  if (!Array.isArray(raw)) return [];
  const out: Transaction[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = asString(item.id);
    const instrumentId = asString(item.instrumentId);
    const date = asString(item.date);
    if (!id || !instrumentId || !date) continue;
    if (!isEnum(item.type, TRANSACTION_TYPES)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const quantity = asNumber(item.quantity, 0);
    const price = asNumber(item.price, 0);

    const transaction: Transaction = {
      id,
      instrumentId,
      type: item.type as TransactionType,
      status: asEnum<TransactionStatus>(item.status, TRANSACTION_STATUSES, 'CONFIRMED'),
      date,
      quantity,
      price,
      amount: asNumber(item.amount, Math.abs(quantity * price)),
      currency: asCurrency(item.currency),
      fxRate: asNumber(item.fxRate, 1),
    };

    const fee = optNumber(item.fee);
    if (fee !== undefined) transaction.fee = fee;
    const note = optString(item.note);
    if (note) transaction.note = note;
    const source = optEnum<NonNullable<Transaction['source']>>(item.source, TRANSACTION_SOURCES);
    if (source) transaction.source = source;
    const meta = optMeta(item.meta);
    if (meta) transaction.meta = meta;

    out.push(transaction);
  }
  return out;
}

/** holdings.plans → InvestmentPlan[]；缺 id/instrumentId/amount/frequency 的条目直接跳过 */
export function normalizePlans(raw: unknown): InvestmentPlan[] {
  if (!Array.isArray(raw)) return [];
  const out: InvestmentPlan[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = asString(item.id);
    const instrumentId = asString(item.instrumentId);
    const amount = optNumber(item.amount);
    if (!id || !instrumentId || amount === undefined) continue;
    if (!isEnum(item.frequency, PLAN_FREQUENCIES)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const plan: InvestmentPlan = {
      id,
      instrumentId,
      amount,
      frequency: item.frequency as PlanFrequency,
      executionDay: asNumber(item.executionDay, 1),
      startDate: asString(item.startDate),
      holidayPolicy: asEnum<'NEXT_TRADING_DAY' | 'PREV_TRADING_DAY'>(
        item.holidayPolicy,
        HOLIDAY_POLICIES,
        'NEXT_TRADING_DAY',
      ),
      monthEndPolicy: 'LAST_TRADING_DAY',
      autoConfirm: asBoolean(item.autoConfirm, false),
      status: asEnum<PlanStatus>(item.status, PLAN_STATUSES, 'ACTIVE'),
    };

    const endDate = optString(item.endDate);
    if (endDate) plan.endDate = endDate;
    const nextRunDate = optString(item.nextRunDate);
    if (nextRunDate) plan.nextRunDate = nextRunDate;

    out.push(plan);
  }
  return out;
}

/**
 * holdings.json → 个人数据三切片。
 * 任一切片解析后为空（文件缺该键 / 全是脏数据）→ 回退到对应内置种子，
 * 保证 demo 不被一次手滑编辑整段抹掉。
 */
export function normalizePersonalData(raw: unknown): PersonalSlices {
  const root = isRecord(raw) ? raw : {};
  const instruments = normalizeInstruments(root.instruments);
  const transactions = normalizeTransactions(root.transactions);
  const plans = normalizePlans(root.plans);
  return {
    instruments: instruments.length > 0 ? instruments : seedInstruments,
    transactions: transactions.length > 0 ? transactions : seedTransactions,
    plans: plans.length > 0 ? plans : seedPlans,
  };
}

/**
 * 导入校验：原始 JSON 里至少要有一个非空的个人数据切片。
 * 必须看「归一化之前」的原始结构 —— normalizePersonalData 会用种子兜底，
 * 拿它的结果判空永远为真，起不到校验作用。
 */
export function hasPersonalSlices(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return (['instruments', 'transactions', 'plans'] as const).some((key) => {
    const slice = raw[key];
    return Array.isArray(slice) && slice.length > 0;
  });
}

// ============ 加载 ============

export interface LoadPersonalDataOptions {
  signal?: AbortSignal;
  /** 便于单测注入；默认使用全局 fetch */
  fetchImpl?: typeof fetch;
}

function describeError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

/** 内置种子兜底 bundle（文件不可用时的最后防线） */
function seedBundle(warnings: string[]): PersonalDataBundle {
  return {
    instruments: seedInstruments,
    transactions: seedTransactions,
    plans: seedPlans,
    warnings,
    source: 'seed-fallback',
  };
}

/**
 * 加载 public/data/holdings.json。
 * 404 / 网络异常 / JSON 损坏一律降级为内置种子并记录 warning —— 本函数不抛出。
 */
export async function loadPersonalData(
  options: LoadPersonalDataOptions = {},
): Promise<PersonalDataBundle> {
  try {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 fetch');
    const response = await fetchImpl(dataUrl(HOLDINGS_FILE), {
      signal: options.signal,
      cache: 'no-cache',
    });
    if (!response.ok) {
      throw new Error(`${HOLDINGS_FILE} 请求失败（HTTP ${response.status}）`);
    }
    const raw = (await response.json()) as unknown;
    const slices = normalizePersonalData(raw);
    return { ...slices, warnings: [], source: 'file' };
  } catch (error) {
    return seedBundle([`holdings.json 加载失败，已回退内置种子：${describeError(error)}`]);
  }
}

// ============ 合并 ============

/**
 * 把 localStorage 运行期编辑叠加到 holdings.json 基线之上。
 * 逐切片判定：overlay 提供了非空数组 → overlay 胜出；否则沿用基线。
 * 空数组按「没有 overlay」处理，避免首次挂载的空壳缓存把基线洗掉。
 */
export function mergePersonalData(
  baseline: PersonalSlices,
  overlay: PersonalOverlay,
): PersonalSlices {
  const pick = <T>(over: T[] | undefined, base: T[]): T[] =>
    Array.isArray(over) && over.length > 0 ? over : base;

  return {
    instruments: pick(overlay?.instruments, baseline.instruments),
    transactions: pick(overlay?.transactions, baseline.transactions),
    plans: pick(overlay?.plans, baseline.plans),
  };
}

// ============ 导出 ============

/** 把当前个人数据序列化为 holdings.json 文本，供「导出」按钮下载后提交回仓库 */
export function downloadHoldings(
  state: Pick<DataState, 'instruments' | 'transactions' | 'plans'>,
): string {
  const payload = {
    version: HOLDINGS_VERSION,
    instruments: state.instruments,
    transactions: state.transactions,
    plans: state.plans,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

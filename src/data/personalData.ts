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
 * - 防御式解析：单条脏数据只丢自己，不影响同切片其它行，更不影响其它切片。
 * - ★空切片就是空：文件能读到时一律尊重用户意图（「清空个人数据」必须真的能清空），
 *   只有文件缺失 / 网络失败 / JSON 损坏（catch 分支）才回退内置种子，保证全新部署不白屏。
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
  /** 加载过程中的降级告警（缺文件 / 网络失败 / JSON 损坏 → 回退种子） */
  warnings: string[];
  /** file = 来自 holdings.json；seed-fallback = 文件不可用，用内置种子兜底 */
  source: 'file' | 'seed-fallback';
  /** holdings.json 顶层 generatedAt（导出时写入）；文件未带则 undefined */
  generatedAt?: string;
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

/** normalizePersonalDataDetailed 的返回：切片 + 解析告警 */
export interface NormalizedPersonalData {
  slices: PersonalSlices;
  /** 解析告警。当前解析路径不产生告警（空切片是合法状态），保留字段以兼容调用方 */
  warnings: string[];
}

/**
 * holdings.json → 个人数据三切片。
 *
 * ★空切片即空：文件既然读到了，就完全按文件内容还原。
 * 早期实现会在切片为空时回退内置演示种子，导致用户「清空个人数据」后
 * 每次刷新都被 demo 数据回填，永远回不到空白账本 —— 那是对用户意图的覆盖。
 * 文件级不可用（404 / 网络失败 / JSON 损坏）的兜底放在 loadPersonalData 的 catch 分支。
 */
export function normalizePersonalDataDetailed(raw: unknown): NormalizedPersonalData {
  const root = isRecord(raw) ? raw : {};

  return {
    slices: {
      instruments: normalizeInstruments(root.instruments),
      transactions: normalizeTransactions(root.transactions),
      plans: normalizePlans(root.plans),
    },
    warnings: [],
  };
}

/**
 * holdings.json → 个人数据三切片（丢弃告警的简版）。
 * 保留原签名供导入路径与既有调用方使用；需要感知降级请用 normalizePersonalDataDetailed。
 */
export function normalizePersonalData(raw: unknown): PersonalSlices {
  return normalizePersonalDataDetailed(raw).slices;
}

/**
 * 导入专用合并：文件里有的切片才覆盖，文件里没有的切片**保留当前数据**。
 *
 * 与 normalizePersonalData 的区别在于兜底对象：
 * 后者缺片回退「内置演示种子」（适合冷启动基线），
 * 导入场景下那样做会把用户当前的流水/计划被演示数据洗掉 —— 属于数据丢失，
 * 因此这里以 current 兜底，只做增量替换。
 */
export function mergeImportedSlices(
  current: PersonalSlices,
  raw: unknown,
): { slices: PersonalSlices; warnings: string[] } {
  const root = isRecord(raw) ? raw : {};
  const warnings: string[] = [];

  /** 文件该切片为空 → 保留当前切片并记一条提示 */
  const keepCurrent = <T>(parsed: T[], keep: T[], key: string): T[] => {
    if (parsed.length > 0) return parsed;
    warnings.push(`${HOLDINGS_FILE} 未包含 ${key}，已保留当前数据`);
    return keep;
  };

  const instruments = keepCurrent(normalizeInstruments(root.instruments), current.instruments, 'instruments');
  const transactions = keepCurrent(normalizeTransactions(root.transactions), current.transactions, 'transactions');
  const plans = keepCurrent(normalizePlans(root.plans), current.plans, 'plans');

  return { slices: { instruments, transactions, plans }, warnings };
}

/**
 * 导入校验：原始 JSON 里至少要有一个非空的个人数据切片。
 * 看「归一化之前」的原始结构：空白基线文件（三片皆空）不应被当作有效导入源，
 * 否则一次误选文件就会把用户当前账本洗空。
 */
export function hasPersonalSlices(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return (['instruments', 'transactions', 'plans'] as const).some((key) => {
    const slice = raw[key];
    return Array.isArray(slice) && slice.length > 0;
  });
}

// ============ 时间戳比较 ============

/**
 * 判断 a 是否严格晚于 b（基于 Date.parse，NaN 安全；任一非法返回 false）。
 *
 * 为什么不能直接用字符串比较：holdings.json 的 generatedAt 可能来自不同生成方式，
 * 精度并不统一 —— 数据管道写 6 位微秒（`...52.048750Z`），downloadHoldings 写 3 位毫秒
 * （`...52.048Z`），甚至可能出现无小数秒的 `...52Z`。字典序在这些混合精度下会误判
 * （'...52.048Z' > '...52.048750Z' 为 true、'...52.048750Z' > '...52Z' 为 false），
 * 导致「服务器有更新」提示误报或漏报。改用时间语义比较，跨精度稳定。
 *
 * 注意：Date.parse 只保留到毫秒，亚毫秒差异（如 048750µs vs 048ms）视为同一时刻 →
 * 返回 false（宁可漏提示，也不误报「服务器有更新」诱导用户覆盖本地编辑）。
 */
export function isNewerIso(a?: string, b?: string): boolean {
  const ta = typeof a === 'string' ? Date.parse(a) : NaN;
  const tb = typeof b === 'string' ? Date.parse(b) : NaN;
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return ta > tb;
}

// ============ 加载 ============

export interface LoadPersonalDataOptions {
  signal?: AbortSignal;
  /** 便于单测注入；默认使用全局 fetch */
  fetchImpl?: typeof fetch;
  /**
   * fetch 缓存策略，默认 'default'（遵循 _headers 的 max-age=3600）。
   * 用户在设置页点「从服务器重新加载」时传 'no-cache'，确保拿到刚提交的基线。
   */
  cache?: RequestCache;
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
 *
 * - 文件读取成功 → 完全按文件内容返回（空切片就是空，source:'file'，无告警）。
 * - 404 / 网络异常 / JSON 损坏 → 降级为内置种子并记录 warning（全新部署不至于白屏）。
 *
 * 本函数不抛出。
 */
export async function loadPersonalData(
  options: LoadPersonalDataOptions = {},
): Promise<PersonalDataBundle> {
  try {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 fetch');
    const response = await fetchImpl(dataUrl(HOLDINGS_FILE), {
      signal: options.signal,
      cache: options.cache ?? 'default',
    });
    if (!response.ok) {
      throw new Error(`${HOLDINGS_FILE} 请求失败（HTTP ${response.status}）`);
    }
    const raw = (await response.json()) as unknown;
    const { slices, warnings } = normalizePersonalDataDetailed(raw);
    // ★文件读到了就以文件为准：三片皆空 = 用户清空后的空白基线，不是异常
    return {
      ...slices,
      warnings,
      source: 'file',
      generatedAt: isRecord(raw) ? optString(raw.generatedAt) : undefined,
    };
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
    // 导出时间戳：回访时用于判断「服务器基线是否比上次接受的更新」
    generatedAt: new Date().toISOString(),
    instruments: state.instruments,
    transactions: state.transactions,
    plans: state.plans,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

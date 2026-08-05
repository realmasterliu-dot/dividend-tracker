import {
  AppSettings,
  Currency,
  DataState,
  DividendEvent,
  DividendForm,
  DividendStatus,
  FxSnapshot,
  Notification,
  PriceSnapshot,
} from '@/types';
import { todayISO } from '@/lib/clock';
import { buildTaxLots } from '@/lib/calc/position';
import { enrichAllDividends } from '@/lib/calc/tax';
import { generate } from '@/lib/notification';

/**
 * 真实数据接入层 —— 读取数据管道产物 public/data/*.json 并映射为 DataState 的市场数据切片。
 *
 * 边界约定：
 * - 只负责「市场数据」：prices / fx / dividends / sourceHealth / lastUpdated。
 *   个人数据（instruments / transactions / plans）仍由种子与用户本地维护。
 * - 只搬运「事实字段」。分红的派生金额（quantityAtRecord / gross / tax / net）一律不在此计算，
 *   由 TaxEngine 在读取时按用户持仓推导（architecture.md：推导不存储）。
 * - 每次启动都以管道数据为准覆盖本地缓存的市场数据，避免旧缓存盖住真实行情。
 */

// ============ 管道元信息 ============

export interface PipelineMeta {
  generatedAt: string;
  pipelineVersion: string;
  instrumentCount: number;
  warnings: string[];
  durationSeconds: number;
  categories: string[];
}

export interface MarketDataBundle {
  prices: PriceSnapshot[];
  fx: FxSnapshot[];
  dividends: DividendEvent[];
  sourceHealth: DataState['sourceHealth'];
  /** 管道产出时间（ISO），用于「数据新鲜度」展示 */
  lastUpdated: string;
  meta: PipelineMeta | null;
  /** 加载过程中的降级告警（缺文件 / 格式异常 / 管道自带 warnings） */
  warnings: string[];
}

// ============ 解析工具（防御式：管道产物损坏也不能白屏） ============

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

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const CURRENCIES: readonly string[] = ['CNY', 'USD', 'HKD'];
const DIVIDEND_STATUSES: readonly string[] = [
  'PROPOSED',
  'APPROVED',
  'DECLARED',
  'EX_DIVIDEND',
  'PAID',
  'RECONCILED',
];
const DIVIDEND_FORMS: readonly string[] = ['CASH', 'SCRIP', 'CASH_SCRIP'];
const HEALTH_STATUSES: readonly string[] = ['GREEN', 'YELLOW', 'RED'];

function asCurrency(value: unknown, fallback: Currency = 'CNY'): Currency {
  return typeof value === 'string' && CURRENCIES.includes(value) ? (value as Currency) : fallback;
}

function asDividendStatus(value: unknown): DividendStatus {
  return typeof value === 'string' && DIVIDEND_STATUSES.includes(value)
    ? (value as DividendStatus)
    : 'PAID';
}

function asDividendForm(value: unknown): DividendForm {
  return typeof value === 'string' && DIVIDEND_FORMS.includes(value)
    ? (value as DividendForm)
    : 'CASH';
}

function asHealthStatus(value: unknown): 'GREEN' | 'YELLOW' | 'RED' {
  return typeof value === 'string' && HEALTH_STATUSES.includes(value)
    ? (value as 'GREEN' | 'YELLOW' | 'RED')
    : 'YELLOW';
}

// ============ 归一化 ============

/** prices.json → PriceSnapshot[]（按日期升序，便于 forward-fill 与快照重建） */
export function normalizePrices(raw: unknown): PriceSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: PriceSnapshot[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const instrumentId = asString(item.instrumentId);
    const date = asString(item.date);
    const price = asNumber(item.price, Number.NaN);
    if (!instrumentId || !date || !Number.isFinite(price)) continue;
    out.push({
      instrumentId,
      date,
      price,
      currency: asCurrency(item.currency),
      fxRate: asNumber(item.fxRate, 1),
      source: asString(item.source, 'pipeline'),
      navDate: optString(item.navDate),
    });
  }
  out.sort((a, b) => (a.date === b.date ? a.instrumentId.localeCompare(b.instrumentId) : a.date.localeCompare(b.date)));
  return out;
}

/**
 * fx.json → FxSnapshot[]
 * ★必须按日期升序：fxOn() 依赖有序序列做 forward-fill，latestFx() 取末位元素。
 */
export function normalizeFx(raw: unknown): FxSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: FxSnapshot[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const date = asString(item.date);
    if (!date || !isRecord(item.rates)) continue;
    const rates: Record<string, number> = {};
    for (const [key, value] of Object.entries(item.rates)) {
      const rate = asNumber(value, Number.NaN);
      if (Number.isFinite(rate) && rate > 0) rates[key] = rate;
    }
    out.push({ date, rates });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * dividends.json → DividendEvent[]
 * 派生金额字段一律写 0 占位，由 TaxEngine.enrichDividend 按持仓推导后覆盖。
 */
export function normalizeDividends(raw: unknown): DividendEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: DividendEvent[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const instrumentId = asString(item.instrumentId);
    const sourceKey = asString(item.sourceKey);
    const id = asString(item.id) || (sourceKey ? `div-${sourceKey}` : '');
    if (!instrumentId || !id) continue;
    out.push({
      id,
      instrumentId,
      status: asDividendStatus(item.status),
      announceDate: optString(item.announceDate),
      recordDate: optString(item.recordDate),
      exDate: optString(item.exDate),
      payDate: optString(item.payDate),
      payDateEstimated: asBoolean(item.payDateEstimated),
      perShareAmount: asNumber(item.perShareAmount),
      currency: asCurrency(item.currency),
      // ↓ 全部为推导字段，此处仅占位
      quantityAtRecord: 0,
      grossAmount: 0,
      taxRateApplied: 0,
      taxWithheld: 0,
      contingentTax: 0,
      netAmount: 0,
      taxBracket: 'NONE',
      dividendForm: asDividendForm(item.dividendForm),
      isSpecial: asBoolean(item.isSpecial),
      isEstimate: asBoolean(item.isEstimate),
      manual: asBoolean(item.manual),
      sourceKey: sourceKey || id,
    });
  }
  out.sort((a, b) => {
    const ka = a.payDate ?? a.exDate ?? a.recordDate ?? '';
    const kb = b.payDate ?? b.exDate ?? b.recordDate ?? '';
    return ka === kb ? a.instrumentId.localeCompare(b.instrumentId) : ka.localeCompare(kb);
  });
  return out;
}

/** source_health.json → DataState['sourceHealth'] */
export function normalizeSourceHealth(raw: unknown): DataState['sourceHealth'] {
  if (!isRecord(raw)) return {};
  const out: DataState['sourceHealth'] = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    out[key] = {
      lastSuccess: asString(value.lastSuccess),
      consecutiveFailures: asNumber(value.consecutiveFailures),
      status: asHealthStatus(value.status),
    };
  }
  return out;
}

/** meta.json → PipelineMeta */
export function normalizeMeta(raw: unknown): PipelineMeta | null {
  if (!isRecord(raw)) return null;
  return {
    generatedAt: asString(raw.generatedAt),
    pipelineVersion: asString(raw.pipelineVersion),
    instrumentCount: asNumber(raw.instrumentCount),
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map((w) => asString(w)).filter(Boolean) : [],
    durationSeconds: asNumber(raw.durationSeconds),
    categories: Array.isArray(raw.categories) ? raw.categories.map((c) => asString(c)).filter(Boolean) : [],
  };
}

// ============ 加载 ============

/** public/ 在 Vite 中映射到站点根；BASE_URL 兼容子路径部署（如 GitHub Pages） */
export function dataUrl(fileName: string): string {
  let base = '/';
  try {
    const env = import.meta.env as Record<string, unknown> | undefined;
    const raw = env?.BASE_URL;
    if (typeof raw === 'string' && raw.length > 0) base = raw;
  } catch {
    base = '/';
  }
  return `${base.replace(/\/+$/, '')}/data/${fileName}`;
}

export interface LoadMarketDataOptions {
  signal?: AbortSignal;
  /** 便于单测注入；默认使用全局 fetch */
  fetchImpl?: typeof fetch;
}

async function fetchJson(fileName: string, options: LoadMarketDataOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 fetch');
  const response = await fetchImpl(dataUrl(fileName), {
    signal: options.signal,
    cache: 'no-cache',
  });
  if (!response.ok) throw new Error(`${fileName} 请求失败（HTTP ${response.status}）`);
  return (await response.json()) as unknown;
}

/**
 * 并行加载全部管道产物。
 * 单个文件失败不阻断整体：该切片降级为空并记录 warning，让 UI 能如实展示"部分数据缺失"。
 */
export async function loadMarketData(options: LoadMarketDataOptions = {}): Promise<MarketDataBundle> {
  const files = ['prices.json', 'dividends.json', 'fx.json', 'source_health.json', 'meta.json'] as const;
  const settled = await Promise.allSettled(files.map((file) => fetchJson(file, options)));

  const warnings: string[] = [];
  const valueOf = (index: number): unknown => {
    const result = settled[index];
    if (result.status === 'fulfilled') return result.value;
    warnings.push(`${files[index]} 加载失败：${describeError(result.reason)}`);
    return null;
  };

  const prices = normalizePrices(valueOf(0));
  const dividends = normalizeDividends(valueOf(1));
  const fx = normalizeFx(valueOf(2));
  const sourceHealth = normalizeSourceHealth(valueOf(3));
  const meta = normalizeMeta(valueOf(4));

  if (prices.length === 0) warnings.push('行情数据为空，持仓市值将无法计算');
  if (fx.length === 0) warnings.push('汇率数据为空，外币资产按 1:1 兜底换算');
  for (const warning of meta?.warnings ?? []) warnings.push(`管道告警：${warning}`);

  const lastUpdated = meta?.generatedAt || latestSourceSuccess(sourceHealth) || latestPriceDate(prices);

  return { prices, fx, dividends, sourceHealth, lastUpdated, meta, warnings };
}

function describeError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

function latestSourceSuccess(sourceHealth: DataState['sourceHealth']): string {
  let latest = '';
  for (const entry of Object.values(sourceHealth)) {
    if (entry.lastSuccess && entry.lastSuccess > latest) latest = entry.lastSuccess;
  }
  return latest;
}

function latestPriceDate(prices: PriceSnapshot[]): string {
  const last = prices[prices.length - 1];
  return last ? `${last.date}T00:00:00Z` : '';
}

// ============ 合并进 DataState ============

/** 用户对分红事件的手工订正（管道无法感知，必须跨刷新保留） */
function carryUserEdits(incoming: DividendEvent, previous: DividendEvent): DividendEvent {
  const merged: DividendEvent = { ...incoming };
  if (previous.actualReceived !== undefined) {
    merged.actualReceived = previous.actualReceived;
    merged.status = 'RECONCILED';
  }
  if (previous.taxWithheldOverride !== undefined) {
    merged.taxWithheldOverride = previous.taxWithheldOverride;
  }
  return merged;
}

/**
 * 分红合并策略：管道数据为事实来源，叠加用户手工订正；本地手工录入的事件单独保留。
 */
export function mergeDividends(
  existing: DividendEvent[],
  incoming: DividendEvent[],
): DividendEvent[] {
  const previousById = new Map(existing.map((d) => [d.id, d]));
  const incomingIds = new Set(incoming.map((d) => d.id));

  const merged = incoming.map((d) => {
    const previous = previousById.get(d.id);
    return previous ? carryUserEdits(d, previous) : d;
  });

  // 用户手工录入且管道未覆盖的事件不能丢
  const manualOnly = existing.filter((d) => d.manual && !incomingIds.has(d.id));
  return [...merged, ...manualOnly];
}

/** 重置演示数据时清除用户手工订正，回到管道原始事实 */
export function stripUserEdits(dividends: DividendEvent[]): DividendEvent[] {
  return dividends
    .filter((d) => !d.manual)
    .map((d) => {
      const next: DividendEvent = { ...d };
      delete next.actualReceived;
      delete next.taxWithheldOverride;
      delete next.deviationPct;
      if (next.status === 'RECONCILED') next.status = 'PAID';
      return next;
    });
}

/**
 * 将管道数据合入 DataState：覆盖市场数据切片，保留个人数据，并重算通知。
 *
 * 通知生成前先跑一遍 TaxEngine 推导，否则通知里的「预计到手金额」会是占位的 0。
 * 已读状态按去重 key 继承，避免每次刷新通知重新变红点。
 */
export function applyMarketData(
  base: DataState,
  bundle: MarketDataBundle,
  settings: AppSettings,
): DataState {
  const readKeys = new Set(base.notifications.filter((n) => n.read).map((n) => n.key));
  // 'gen-' 前缀为上一轮自动生成的通知，重算前先清掉，避免 dedup 把新通知全部拦下
  const manualNotifications = base.notifications.filter((n) => !n.id.startsWith('gen-'));

  const next: DataState = {
    ...base,
    prices: bundle.prices,
    fx: bundle.fx,
    dividends: mergeDividends(base.dividends, bundle.dividends),
    sourceHealth: bundle.sourceHealth,
    lastUpdated: bundle.lastUpdated,
    notifications: manualNotifications,
  };

  const enrichedDividends = enrichAllDividends(next.dividends, {
    instruments: next.instruments,
    lotsMap: buildTaxLots(next.transactions),
    settings,
    fx: next.fx,
    today: todayISO(),
    transactions: next.transactions,
  });

  const generated: Notification[] = generate(
    { ...next, dividends: enrichedDividends },
    settings.stalenessThresholdHours,
  ).map((n) => (readKeys.has(n.key) ? { ...n, read: true } : n));

  return { ...next, notifications: [...manualNotifications, ...generated] };
}

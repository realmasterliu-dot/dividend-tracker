import {
  AppSettings,
  DataState,
  DividendEvent,
  DividendPrediction,
  PortfolioMetrics,
  PortfolioSnapshot,
  Position,
  ReturnBreakdown,
  TodoItem,
  Transaction,
} from '@/types';
import { addDays, daysBetween, todayISO, tradingDaysBetween } from '@/lib/clock';
import { buildTaxLots, derivePositionsFromLots } from '@/lib/calc/position';
import { enrichAllDividends, isPaidStatus } from '@/lib/calc/tax';
import { predictAll } from '@/lib/calc/prediction';
import {
  buildSnapshots,
  computePortfolioMetrics,
  enrichPositionsWithDividends,
  snapshotStats,
  AggregateStats,
} from '@/lib/calc/portfolio';
import { breakdown } from '@/lib/calc/returns';

/**
 * 派生选择器（architecture.md §2.5 selectors.ts）
 * 内部调 Engine；useMemo 缓存；推导不存储。
 */

export interface PortfolioDerived {
  positions: Position[];
  enrichedDividends: DividendEvent[];
  predictions: Record<string, DividendPrediction>;
  totalMarketValue: number;
  totalCostValue: number;
  unrealizedPnl: number;
  ttmDividendTotal: number;
  contingentTaxTotal: number;
  taxWithheldTotal: number;
  netReceivedTotal: number;
  metrics: PortfolioMetrics;
  breakdown: ReturnBreakdown;
  snapshots: PortfolioSnapshot[];
  snapshotStats: AggregateStats;
  todos: TodoItem[];
  pendingTxCount: number;
  staleCount: number;
  backfillCount: number;
}

export function derivePortfolio(state: DataState, settings: AppSettings): PortfolioDerived {
  const today = todayISO();
  const lotsMap = buildTaxLots(state.transactions);
  const positions = derivePositionsFromLots(
    lotsMap,
    state.instruments,
    state.prices,
    state.fx,
    settings,
  );
  const enrichedDividends = enrichAllDividends(state.dividends, {
    instruments: state.instruments,
    lotsMap,
    settings,
    fx: state.fx,
    today,
    transactions: state.transactions,
  });

  const heldIds = positions.map((p) => p.instrumentId);
  const predictions = predictAll(enrichedDividends, heldIds);

  const enrichedPositions = enrichPositionsWithDividends(positions, enrichedDividends, predictions);

  const snapshots = buildSnapshots(
    state.transactions,
    state.instruments,
    state.prices,
    state.fx,
    settings,
    today,
  );

  const metrics = computePortfolioMetrics(
    enrichedPositions,
    state.transactions,
    enrichedDividends,
    snapshots,
    settings,
    today,
  );

  const bd = breakdown(enrichedPositions, state.transactions, enrichedDividends, settings);

  const totalMarketValue = enrichedPositions.reduce((s, p) => s + p.marketValue, 0);
  const totalCostValue = enrichedPositions.reduce((s, p) => s + p.costValue, 0);
  const unrealizedPnl = enrichedPositions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const ttmDividendTotal = enrichedPositions.reduce((s, p) => s + p.ttmDividend, 0);

  let contingentTaxTotal = 0;
  let taxWithheldTotal = 0;
  let netReceivedTotal = 0;
  for (const d of enrichedDividends) {
    if (!isPaidStatus(d.status)) continue;
    contingentTaxTotal += d.contingentTax;
    taxWithheldTotal += d.taxWithheld;
    netReceivedTotal += d.netAmount;
  }

  const todos = buildTodos(state, settings, enrichedPositions, enrichedDividends, lotsMap);

  const pendingTxCount = state.transactions.filter((t) => t.status === 'PENDING').length;
  const staleCount = enrichedPositions.filter((p) =>
    isPositionStale(p, today, settings.stalenessThresholdHours),
  ).length;
  const backfillCount = enrichedDividends.filter(
    (d) => isPaidStatus(d.status) && d.actualReceived === undefined,
  ).length;

  return {
    positions: enrichedPositions,
    enrichedDividends,
    predictions,
    totalMarketValue,
    totalCostValue,
    unrealizedPnl,
    ttmDividendTotal,
    contingentTaxTotal,
    taxWithheldTotal,
    netReceivedTotal,
    metrics,
    breakdown: bd,
    snapshots,
    snapshotStats: snapshotStats(snapshots),
    todos,
    pendingTxCount,
    staleCount,
    backfillCount,
  };
}

// ============ 待办区 ============

/**
 * 持仓是否「陈旧到需告警」：以交易日为口径，且达到 stalenessThresholdHours 阈值。
 * staleDays 仍是日历日（用于展示「N天前」），此处仅用于告警判定，
 * 避免「昨夜收盘 / 周末无交易」这类每日管道的常态被误判为数据陈旧。
 */
function isPositionStale(pos: Position, today: string, thresholdHours: number): boolean {
  if (pos.staleDays <= 0) return false;
  const priceDate = addDays(today, -pos.staleDays);
  const trading = tradingDaysBetween(priceDate, today);
  return trading * 24 >= thresholdHours;
}

export function buildTodos(
  state: DataState,
  settings: AppSettings,
  positions: Position[],
  dividends: DividendEvent[],
  lotsMap: Map<string, import('@/types').TaxLot[]>,
): TodoItem[] {
  const todos: TodoItem[] = [];
  const today = todayISO();

  const pending = state.transactions.filter((t) => t.status === 'PENDING');
  if (pending.length > 0) {
    todos.push({
      id: 'todo-pending',
      kind: 'PENDING_TX',
      title: `待确认流水 ${pending.length} 笔`,
      detail: pending
        .map((t) => `${t.instrumentId} ${t.date} ${t.type} ¥${t.amount.toFixed(0)}`)
        .join('；'),
      severity: pending.length > 3 ? 'ERROR' : 'WARN',
    });
  }

  const stale = positions.filter((p) => isPositionStale(p, today, settings.stalenessThresholdHours));
  if (stale.length > 0) {
    todos.push({
      id: 'todo-stale',
      kind: 'DATA_STALE',
      title: `${stale.length} 只标的价格陈旧`,
      detail: stale.map((p) => `${p.instrument.symbol} ⚠${p.staleDays}天前`).join('；'),
      severity: 'WARN',
    });
  }

  const backfill = dividends.filter((d) => isPaidStatus(d.status) && d.actualReceived === undefined);
  if (backfill.length > 0) {
    todos.push({
      id: 'todo-backfill',
      kind: 'PAY_BACKFILL',
      title: `${backfill.length} 笔分红待回填实际到账`,
      detail: '回填后系统显示估算偏差率（校准闭环）',
      severity: 'INFO',
    });
  }

  const corpActions = state.transactions.filter(
    (t) =>
      t.status === 'PENDING' &&
      (t.type === 'SPLIT' || t.type === 'BONUS' || t.type === 'TRANSFER' || t.type === 'FUND_SPLIT'),
  );
  if (corpActions.length > 0) {
    todos.push({
      id: 'todo-corp',
      kind: 'CORP_ACTION',
      title: `公司行动待确认 ${corpActions.length} 条`,
      detail: '拆股/送转/基金拆分确认后调整持仓，不静默修改',
      severity: 'WARN',
    });
  }

  // A股税档跨档提醒：满 1 年前 7 天
  const bracketSoon = positions.filter((p) => {
    if (p.instrument.market !== 'A_SHARE') return false;
    const lots = lotsMap.get(p.instrumentId) ?? [];
    return lots.some((lot) => {
      const days = daysBetween(lot.originalBuyDate, today);
      return days >= 358 && days < 365;
    });
  });
  if (bracketSoon.length > 0) {
    todos.push({
      id: 'todo-bracket',
      kind: 'TAX_BRACKET',
      title: `${bracketSoon.length} 笔持仓即将跨入免税档`,
      detail: bracketSoon.map((p) => p.instrument.symbol).join('；') + ' · 再持有数日或有税负归零',
      severity: 'INFO',
    });
  }

  return todos;
}

// ============ Ticker Tape ============

export interface TickerItem {
  symbol: string;
  name: string;
  market: Position['instrument']['market'];
  price: number;
  changePct: number;
}

export function selectTickerItems(state: DataState, positions: Position[]): TickerItem[] {
  const today = todayISO();
  return positions.map((p) => {
    const changePct = p.prevPrice > 0 ? (p.marketPrice - p.prevPrice) / p.prevPrice : 0;
    return {
      symbol: p.instrument.symbol,
      name: p.instrument.name,
      market: p.instrument.market,
      price: p.marketPrice,
      changePct,
    };
  });
}

// ============ 未来 12 个月现金流（分红预测表） ============

export interface CashflowMonth {
  month: string; // 'YYYY-MM'
  lower: number;
  upper: number;
  declared: number; // 已宣告确定金额
  items: DividendEvent[];
}

export function selectCashflow12m(dividends: DividendEvent[]): CashflowMonth[] {
  const today = todayISO();
  const months: CashflowMonth[] = [];
  const start = new Date(today);
  for (let i = 1; i <= 12; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ month: key, lower: 0, upper: 0, declared: 0, items: [] });
  }

  for (const d of dividends) {
    const payDate = d.payDate ?? d.exDate ?? d.recordDate;
    if (!payDate || d.status === 'PROPOSED' || d.status === 'APPROVED') continue;
    const key = payDate.slice(0, 7);
    const month = months.find((m) => m.month === key);
    if (!month) continue;
    month.items.push(d);
    if (d.status === 'DECLARED' || d.status === 'EX_DIVIDEND') {
      month.declared += d.netAmount;
    } else {
      month.lower += d.netAmount;
      month.upper += d.netAmount;
    }
  }
  return months;
}

export function pendingTransactions(state: DataState): Transaction[] {
  return state.transactions
    .filter((t) => t.status === 'PENDING')
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function daysAgoFromLastUpdated(lastUpdated: string): number {
  const d = new Date(lastUpdated);
  return daysBetween(d.toISOString().slice(0, 10), todayISO());
}

import {
  AppSettings,
  DividendEvent,
  FxSnapshot,
  Instrument,
  Position,
  PortfolioMetrics,
  PortfolioSnapshot,
  PriceSnapshot,
  Transaction,
} from '@/types';
import { compareDates, todayISO } from '../clock';
import { rateFromSnapshot } from './fx';
import { buildQuantityEvents, QuantityEvent } from './position';
import { twr, xirr, xirrCashflows, yocOfPositions } from './returns';

/**
 * PortfolioEngine：组合快照序列 + 汇总指标
 * 资产走势曲线为「近似重建」：基于建仓成本 + 历史行情回填，非逐笔实际记录（PRD §3.2.7）。
 */

function collectAllDates(
  transactions: Transaction[],
  prices: PriceSnapshot[],
  today: string,
): string[] {
  const set = new Set<string>([today]);
  for (const t of transactions) if (t.status === 'CONFIRMED') set.add(t.date);
  for (const p of prices) set.add(p.date);
  return [...set].sort();
}

interface PricePoint {
  date: string;
  price: number;
}

/** 行情按标的分组并按日期升序：一次遍历替代「逐标的全量 filter」的 O(标的 × 行情) */
function groupPriceSeries(prices: PriceSnapshot[]): Map<string, PricePoint[]> {
  const map = new Map<string, PricePoint[]>();
  for (const p of prices) {
    const point: PricePoint = { date: p.date, price: p.price };
    const list = map.get(p.instrumentId);
    if (list) list.push(point);
    else map.set(p.instrumentId, [point]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => compareDates(a.date, b.date));
  }
  return map;
}

const EMPTY_EVENTS: readonly QuantityEvent[] = [];
const EMPTY_SERIES: readonly PricePoint[] = [];

/**
 * 单支标的在快照重建中的游标。
 *
 * dates 升序推进时，事件指针与价格指针都只前进不回退，
 * 因此每支标的的总迭代次数是 O(自身事件数 + 自身行情数)，
 * 而非原来的 O(日期数 × 流水数) + O(日期数 × 行情数)。
 */
interface InstrumentCursor {
  instrument: Instrument;
  events: readonly QuantityEvent[];
  eventIdx: number;
  quantity: number;
  series: readonly PricePoint[];
  priceIdx: number;
  lastPrice: number | undefined;
}

/** 生成组合快照序列（市值 / 累计投入 / 累计分红 三线） */
export function buildSnapshots(
  transactions: Transaction[],
  instruments: Instrument[],
  prices: PriceSnapshot[],
  fx: FxSnapshot[],
  settings: AppSettings,
  today: string,
): PortfolioSnapshot[] {
  const confirmed = transactions.filter((t) => t.status === 'CONFIRMED');
  const dates = collectAllDates(transactions, prices, today);

  // 预处理一次：持仓变动事件 + 行情序列，均按日期升序
  const eventsByInstrument = buildQuantityEvents(confirmed);
  const seriesByInstrument = groupPriceSeries(prices);
  const cursors: InstrumentCursor[] = instruments.map((instrument) => ({
    instrument,
    events: eventsByInstrument.get(instrument.id) ?? EMPTY_EVENTS,
    eventIdx: 0,
    quantity: 0,
    series: seriesByInstrument.get(instrument.id) ?? EMPTY_SERIES,
    priceIdx: 0,
    lastPrice: undefined,
  }));

  // 汇率 forward-fill 同样走指针：同一天所有标的共用一张快照 → 全程 O(汇率条数)
  let fxIdx = 0;
  let fxSnapshot: FxSnapshot | undefined;

  let invested = 0;
  let dividends = 0;
  const snapshots: PortfolioSnapshot[] = [];

  const txsByDate = new Map<string, Transaction[]>();
  for (const tx of confirmed) {
    const list = txsByDate.get(tx.date) ?? [];
    list.push(tx);
    txsByDate.set(tx.date, list);
  }

  for (const date of dates) {
    // 先处理当日流水
    for (const tx of txsByDate.get(date) ?? []) {
      const fxr = tx.fxRate;
      switch (tx.type) {
        case 'BUY':
          invested += (tx.amount + (tx.fee ?? 0)) * fxr;
          break;
        case 'SELL':
          invested -= (tx.amount - (tx.fee ?? 0)) * fxr;
          break;
        case 'DIVIDEND_REINVEST':
          invested += tx.amount * fxr;
          break;
        case 'DIVIDEND_CASH':
          dividends += tx.amount * fxr;
          break;
        case 'TAX_WITHHELD':
          dividends -= tx.amount * fxr;
          break;
        case 'FEE':
          invested += tx.amount * fxr;
          break;
        case 'INCOME':
          dividends += tx.amount * fxr;
          break;
        default:
          break;
      }
    }

    // 汇率指针推进到 <= date 的最近快照
    while (fxIdx < fx.length && compareDates(fx[fxIdx].date, date) <= 0) {
      fxSnapshot = fx[fxIdx];
      fxIdx++;
    }

    // 当日市值（持仓与价格均由指针 forward-fill，不回头重扫）
    let marketValue = 0;
    let heldCount = 0;
    let priceFound = 0;
    for (const cursor of cursors) {
      while (
        cursor.eventIdx < cursor.events.length &&
        compareDates(cursor.events[cursor.eventIdx].date, date) <= 0
      ) {
        const event = cursor.events[cursor.eventIdx];
        cursor.quantity = cursor.quantity * event.ratio + event.delta;
        cursor.eventIdx++;
      }
      if (cursor.quantity <= 0) continue;
      heldCount++;

      // 空仓日跳过推进不影响正确性：下次读取前仍会补齐到当前 date
      while (
        cursor.priceIdx < cursor.series.length &&
        compareDates(cursor.series[cursor.priceIdx].date, date) <= 0
      ) {
        cursor.lastPrice = cursor.series[cursor.priceIdx].price;
        cursor.priceIdx++;
      }
      if (cursor.lastPrice !== undefined) {
        priceFound++;
        const fxr = rateFromSnapshot(fxSnapshot, fx, cursor.instrument.currency, settings.baseCurrency);
        marketValue += cursor.quantity * cursor.lastPrice * fxr;
      }
    }

    const completeness = heldCount === 0 ? 1 : priceFound / heldCount;
    snapshots.push({
      date,
      marketValue,
      invested,
      dividends,
      isEstimated: true,
      dataCompleteness: completeness,
    });
  }

  return snapshots;
}

export interface AggregateStats {
  fillDays: number;
  avgCompleteness: number;
  earliestDate: string;
}

export function snapshotStats(snapshots: PortfolioSnapshot[]): AggregateStats {
  let fillDays = 0;
  let totalCompleteness = 0;
  for (const s of snapshots) {
    totalCompleteness += s.dataCompleteness;
    if (s.dataCompleteness < 1) fillDays++;
  }
  return {
    fillDays,
    avgCompleteness: snapshots.length ? totalCompleteness / snapshots.length : 1,
    earliestDate: snapshots[0]?.date ?? todayISO(),
  };
}

export function computePortfolioMetrics(
  positions: Position[],
  transactions: Transaction[],
  dividends: DividendEvent[],
  snapshots: PortfolioSnapshot[],
  settings: AppSettings,
  today: string,
): PortfolioMetrics {
  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const ttmDividend = positions.reduce((s, p) => s + p.ttmDividend, 0);
  const eligibleMarketValue = positions
    .filter((p) => p.instrument.dividendEligible)
    .reduce((s, p) => s + p.marketValue, 0);

  const flows = xirrCashflows(transactions, totalMarketValue, today);
  const rate = xirr(flows);
  const twrRate = twr(snapshots);
  const yocRate = yocOfPositions(positions);

  return {
    xirr: rate,
    twr: twrRate,
    yoc: yocRate,
    overallYield: totalMarketValue > 0 ? ttmDividend / totalMarketValue : 0,
    incomeYield: eligibleMarketValue > 0 ? ttmDividend / eligibleMarketValue : 0,
  };
}

/** 按状态回填 ttmDividend / dividendYield / yoc / annualDividend / weightPct */
export function enrichPositionsWithDividends(
  positions: Position[],
  dividends: DividendEvent[],
  predictions: Record<string, { lower: number; upper: number }>,
): Position[] {
  const today = todayISO();
  const start12m = new Date(new Date(today).getTime() - 365 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const ttmByInstrument = new Map<string, number>();
  for (const d of dividends) {
    if (d.status !== 'PAID' && d.status !== 'RECONCILED') continue;
    const payDate = d.payDate ?? d.exDate ?? d.recordDate;
    if (!payDate || payDate < start12m) continue;
    ttmByInstrument.set(d.instrumentId, (ttmByInstrument.get(d.instrumentId) ?? 0) + d.netAmount);
  }

  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const eligibleMarketValue = positions
    .filter((p) => p.instrument.dividendEligible)
    .reduce((s, p) => s + p.marketValue, 0);

  return positions.map((pos) => {
    const ttm = ttmByInstrument.get(pos.instrumentId) ?? 0;
    const pred = predictions[pos.instrumentId];
    const annualDividend = pred && pred.upper > 0 ? (pred.lower + pred.upper) / 2 : ttm;
    const dividendYield = pos.marketValue > 0 ? ttm / pos.marketValue : 0;
    const incomeYield = pos.instrument.dividendEligible && eligibleMarketValue > 0 ? ttm / eligibleMarketValue : 0;
    const yocValue = pos.costValue > 0 ? ttm / pos.costValue : 0;
    return {
      ...pos,
      ttmDividend: ttm,
      dividendYield,
      incomeYield,
      yoc: yocValue,
      annualDividend,
      weightPct: totalMarketValue > 0 ? pos.marketValue / totalMarketValue : 0,
    };
  });
}

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
import { todayISO } from '../clock';
import { fxOn } from './fx';
import { quantityOnDate } from './position';
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

function priceSeriesFor(prices: PriceSnapshot[], instrumentId: string): { date: string; price: number }[] {
  return prices
    .filter((p) => p.instrumentId === instrumentId)
    .map((p) => ({ date: p.date, price: p.price }))
    .sort((a, b) => a.date.localeCompare(b.date));
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

  const priceSeries = new Map<string, { date: string; price: number }[]>();
  for (const instr of instruments) {
    priceSeries.set(instr.id, priceSeriesFor(prices, instr.id));
  }

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

    // 当日市值（forward-fill 价格）
    let marketValue = 0;
    let heldCount = 0;
    let priceFound = 0;
    for (const instr of instruments) {
      const qty = quantityOnDate(instr.id, confirmed, date);
      if (qty <= 0) continue;
      heldCount++;
      const series = priceSeries.get(instr.id) ?? [];
      let lastPrice: number | undefined;
      for (const s of series) {
        if (s.date <= date) lastPrice = s.price;
        else break;
      }
      if (lastPrice !== undefined) {
        priceFound++;
        const fxr = fxOn(fx, instr.currency, settings.baseCurrency, date);
        marketValue += qty * lastPrice * fxr;
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

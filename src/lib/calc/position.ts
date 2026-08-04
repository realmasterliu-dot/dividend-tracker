import {
  AppSettings,
  FxSnapshot,
  Instrument,
  Position,
  PriceSnapshot,
  TaxLot,
  Transaction,
} from '@/types';
import { addDays, daysBetween, isSameOrBefore, todayISO } from '../clock';
import { latestFx } from './fx';
import { applyCorpAction, consumeFifo } from './taxLot';

/**
 * PositionEngine（architecture.md 类图）
 * 输入流水 → 输出 TaxLot + Position；纯函数、无副作用、不 import React。
 * 持仓 = 流水推导，推导结果不持久化。
 */

const isConfirmed = (t: Transaction): boolean => t.status === 'CONFIRMED';

const byDate = (a: Transaction, b: Transaction): number =>
  a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date);

/** 流水 → TaxLot 批次（按时间序处理，FIFO） */
export function buildTaxLots(transactions: Transaction[]): Map<string, TaxLot[]> {
  const map = new Map<string, TaxLot[]>();
  const sorted = transactions.filter(isConfirmed).sort(byDate);

  for (const tx of sorted) {
    const lots = map.get(tx.instrumentId) ?? [];
    map.set(tx.instrumentId, lots);
    const qty = tx.quantity;

    switch (tx.type) {
      case 'BUY':
      case 'DIVIDEND_REINVEST': {
        if (qty <= 0) break;
        const feePer = tx.fee && qty > 0 ? tx.fee / qty : 0;
        const localCost = tx.price + feePer;
        lots.push({
          id: `${tx.id}-lot`,
          instrumentId: tx.instrumentId,
          buyDate: tx.date,
          originalBuyDate: tx.date,
          quantity: qty,
          originalQuantity: qty,
          costPerShare: localCost * tx.fxRate,
          costPerShareLocal: localCost,
          sourceTxId: tx.id,
          events: [],
        });
        break;
      }
      case 'SELL': {
        consumeFifo(lots, Math.abs(qty), tx.id, tx.date);
        break;
      }
      case 'SPLIT':
      case 'BONUS':
      case 'TRANSFER':
      case 'FUND_SPLIT': {
        const ratio = typeof tx.meta?.ratio === 'number' ? tx.meta.ratio : 1;
        applyCorpAction(lots, ratio, tx.id, tx.date, tx.type);
        break;
      }
      default:
        break;
    }
  }

  for (const [id, lots] of map) {
    map.set(
      id,
      lots.filter((lot) => lot.quantity > 0),
    );
  }
  return map;
}

function latestPriceSnapshot(prices: PriceSnapshot[], instrumentId: string): PriceSnapshot | undefined {
  let best: PriceSnapshot | undefined;
  for (const p of prices) {
    if (p.instrumentId !== instrumentId) continue;
    if (!best || p.date > best.date) best = p;
  }
  return best;
}

/** 倒数第二个价格快照（当日涨跌计算） */
function prevPriceSnapshot(prices: PriceSnapshot[], instrumentId: string, latestDate: string): PriceSnapshot | undefined {
  let best: PriceSnapshot | undefined;
  for (const p of prices) {
    if (p.instrumentId !== instrumentId) continue;
    if (p.date < latestDate && (!best || p.date > best.date)) best = p;
  }
  return best;
}

export function derivePositionsFromLots(
  lotsMap: Map<string, TaxLot[]>,
  instruments: Instrument[],
  prices: PriceSnapshot[],
  fx: FxSnapshot[],
  settings: AppSettings,
): Position[] {
  const instrumentsById = new Map(instruments.map((i) => [i.id, i]));
  const positions: Position[] = [];
  const today = todayISO();

  for (const [instrumentId, lots] of lotsMap) {
    const instrument = instrumentsById.get(instrumentId);
    if (!instrument) continue;
    const totalQuantity = lots.reduce((s, lot) => s + lot.quantity, 0);
    if (totalQuantity <= 0) continue;
    if (instrument.closed) continue;

    const avgCostLocal =
      lots.reduce((s, lot) => s + lot.quantity * lot.costPerShareLocal, 0) / totalQuantity;
    const avgCost = lots.reduce((s, lot) => s + lot.quantity * lot.costPerShare, 0) / totalQuantity;

    const priceSnap = latestPriceSnapshot(prices, instrumentId);
    const prevSnap = priceSnap ? prevPriceSnapshot(prices, instrumentId, priceSnap.date) : undefined;
    const marketPrice = priceSnap?.price ?? avgCostLocal;
    const prevPrice = prevSnap?.price ?? marketPrice;
    const fxRate = latestFx(fx, instrument.currency, settings.baseCurrency);

    const marketValue = totalQuantity * marketPrice * fxRate;
    const costValue = totalQuantity * avgCost;
    const costValueCurrentFx = totalQuantity * avgCostLocal * fxRate;

    positions.push({
      instrumentId,
      instrument,
      lots,
      totalQuantity,
      avgCostPerShare: avgCost,
      avgCostPerShareLocal: avgCostLocal,
      marketPrice,
      prevPrice,
      fxRate,
      marketValue,
      costValue,
      costValueCurrentFx,
      unrealizedPnl: marketValue - costValue,
      unrealizedPnlPct: costValue > 0 ? (marketValue - costValue) / costValue : 0,
      weightPct: 0, // selectors 里按总市值回填
      ttmDividend: 0, // selectors 里由分红事件回填
      dividendYield: 0,
      incomeYield: 0,
      yoc: 0,
      annualDividend: 0,
      staleDays: priceSnap ? Math.max(0, daysBetween(priceSnap.date, today)) : 99,
      navDate: priceSnap?.navDate,
    });
  }

  positions.sort((a, b) => b.marketValue - a.marketValue);
  return positions;
}

export function derivePositions(
  transactions: Transaction[],
  instruments: Instrument[],
  prices: PriceSnapshot[],
  fx: FxSnapshot[],
  settings: AppSettings,
): Position[] {
  return derivePositionsFromLots(buildTaxLots(transactions), instruments, prices, fx, settings);
}

/** 某标的历史某日的持仓数量（组合快照重建用） */
export function quantityOnDate(instrumentId: string, transactions: Transaction[], date: string): number {
  let qty = 0;
  for (const tx of transactions) {
    if (tx.instrumentId !== instrumentId) continue;
    if (!isSameOrBefore(tx.date, date)) continue;
    if (tx.status !== 'CONFIRMED') continue;
    switch (tx.type) {
      case 'BUY':
      case 'DIVIDEND_REINVEST':
        qty += tx.quantity;
        break;
      case 'SELL':
        qty -= Math.abs(tx.quantity);
        break;
      case 'SPLIT':
      case 'BONUS':
      case 'TRANSFER':
      case 'FUND_SPLIT': {
        const ratio = typeof tx.meta?.ratio === 'number' ? tx.meta.ratio : 1;
        qty *= ratio;
        break;
      }
      default:
        break;
    }
  }
  return qty;
}

/** 用当日价格快照列表快速查找（forward-fill 由调用方保证序列有序） */
export function priceAtDate(series: { date: string; price: number }[], date: string): number | undefined {
  let last: number | undefined;
  for (const s of series) {
    if (isSameOrBefore(s.date, date)) last = s.price;
    else break;
  }
  return last;
}

export function futureDateForStale(days: number): string {
  return addDays(todayISO(), days);
}

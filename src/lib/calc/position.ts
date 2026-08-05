import {
  AppSettings,
  FxSnapshot,
  Instrument,
  Position,
  PriceSnapshot,
  TaxLot,
  Transaction,
} from '@/types';
import { addDays, compareDates, daysBetween, todayISO } from '../clock';
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

// ============ 持仓数量事件（快照重建的共享基元） ============

/**
 * 一次持仓数量变动：`qty ← qty × ratio + delta`。
 *
 * 买入/红利再投为纯加法（ratio = 1），拆股/送转为纯乘法（delta = 0），
 * 统一成一条公式后即可用「单次前向遍历 + 指针」replay 任意日期的持仓，
 * 无需为每个 (日期, 标的) 重新全量扫描流水。
 */
export interface QuantityEvent {
  date: string;
  delta: number;
  ratio: number;
}

/** 单笔流水 → 数量事件；不影响持仓数量的类型（分红/费用/税）返回 null */
function toQuantityEvent(tx: Transaction): QuantityEvent | null {
  switch (tx.type) {
    case 'BUY':
    case 'DIVIDEND_REINVEST':
      return { date: tx.date, delta: tx.quantity, ratio: 1 };
    case 'SELL':
      return { date: tx.date, delta: -Math.abs(tx.quantity), ratio: 1 };
    case 'SPLIT':
    case 'BONUS':
    case 'TRANSFER':
    case 'FUND_SPLIT':
      return {
        date: tx.date,
        delta: 0,
        ratio: typeof tx.meta?.ratio === 'number' ? tx.meta.ratio : 1,
      };
    default:
      return null;
  }
}

/**
 * 确认流水 → 每支标的按日期升序的持仓变动事件序列。
 *
 * 排序口径与 buildTaxLots 一致（按日期，同日保持流水原始相对顺序 —— Array#sort 为稳定排序），
 * 从而让「乘法型公司行动」始终作用在其之前已发生的持仓上，不受数组插入顺序影响。
 */
export function buildQuantityEvents(transactions: Transaction[]): Map<string, QuantityEvent[]> {
  const map = new Map<string, QuantityEvent[]>();
  for (const tx of transactions) {
    if (!isConfirmed(tx)) continue;
    const event = toQuantityEvent(tx);
    if (!event) continue;
    const list = map.get(tx.instrumentId);
    if (list) list.push(event);
    else map.set(tx.instrumentId, [event]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => compareDates(a.date, b.date));
  }
  return map;
}

/**
 * 某标的历史某日的持仓数量。
 *
 * 折叠（fold）语义决定了必须从头累加，二分只能定位截止点，
 * 因此这里保持线性 replay 但提前 break；真正的性能收益来自
 * 去掉 dayjs 比较，以及 buildSnapshots 不再逐 (日期, 标的) 调用本函数。
 */
export function quantityOnDate(instrumentId: string, transactions: Transaction[], date: string): number {
  const events = buildQuantityEvents(transactions).get(instrumentId);
  if (!events) return 0;

  let qty = 0;
  for (const event of events) {
    if (compareDates(event.date, date) > 0) break;
    qty = qty * event.ratio + event.delta;
  }
  return qty;
}

/**
 * 用当日价格快照列表快速查找（forward-fill 由调用方保证序列按日期升序）。
 * 纯查找无累加语义 → 二分收敛到 O(log n)。
 */
export function priceAtDate(series: { date: string; price: number }[], date: string): number | undefined {
  let low = 0;
  let high = series.length - 1;
  let last: number | undefined;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (compareDates(series[mid].date, date) <= 0) {
      last = series[mid].price;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return last;
}

export function futureDateForStale(days: number): string {
  return addDays(todayISO(), days);
}

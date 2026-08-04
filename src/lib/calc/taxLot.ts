import { TaxLot } from '@/types';
import { daysBetween } from '../clock';

/**
 * TaxLot 引擎（architecture.md 类图 PositionEngine）
 * FIFO 消耗 + 送转/拆分批次调整（持股期限起算日不变）。
 */

export interface FifoConsumeResult {
  consumedQty: number;
  remainingQty: number;
}

/** FIFO 消耗：从最早的批次开始扣减数量，记录事件。 */
export function consumeFifo(lots: TaxLot[], sellQty: number, txId: string, date: string): FifoConsumeResult {
  let remaining = Math.abs(sellQty);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const consume = Math.min(lot.quantity, remaining);
    if (consume > 0) {
      lot.quantity -= consume;
      lot.events.push({ txId, date, quantity: -consume, type: 'SELL' });
      remaining -= consume;
    }
  }
  return { consumedQty: Math.abs(sellQty) - remaining, remainingQty: remaining };
}

/** 公司行动：拆股/送股/转增/基金拆分，按比例调整数量与成本价，originalBuyDate 不变。 */
export function applyCorpAction(
  lots: TaxLot[],
  ratio: number,
  txId: string,
  date: string,
  type: TaxLot['events'][number]['type'],
): void {
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  for (const lot of lots) {
    const newQty = lot.quantity * ratio;
    lot.events.push({ txId, date, quantity: newQty - lot.quantity, type });
    lot.quantity = newQty;
    lot.originalQuantity = lot.originalQuantity * ratio;
    lot.costPerShare = lot.costPerShare / ratio;
    lot.costPerShareLocal = lot.costPerShareLocal / ratio;
  }
}

/** 持股天数（自 originalBuyDate 起算，送转股沿用原股买入日） */
export function holdingDays(lot: TaxLot, date: string): number {
  return daysBetween(lot.originalBuyDate, date);
}

/** 某批次当前持股天数（截止日期由调用方传入，通常是今天） */
export function holdingDaysAsOf(lots: TaxLot[], date: string): number[] {
  return lots.map((lot) => holdingDays(lot, date));
}

/** 全部批次中最大持股天数（用于"再持有 N 天归零"） */
export function maxHoldingDays(lots: TaxLot[], date: string): number {
  if (lots.length === 0) return 0;
  return Math.max(...lots.map((lot) => holdingDays(lot, date)));
}

/** 按持股天数加权平均税率（FIFO 口径：每批次按其自身持股期限计税） */
export function weightedRateByHolding(
  lots: TaxLot[],
  date: string,
  rateForDays: (days: number) => number,
): number {
  const totalQty = lots.reduce((s, lot) => s + lot.quantity, 0);
  if (totalQty <= 0) return 0;
  const weighted = lots.reduce((s, lot) => s + lot.quantity * rateForDays(holdingDays(lot, date)), 0);
  return weighted / totalQty;
}

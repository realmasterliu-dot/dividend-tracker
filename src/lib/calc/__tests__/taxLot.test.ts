import { describe, expect, it } from 'vitest';
import { TaxLot } from '@/types';
import { applyCorpAction, consumeFifo, holdingDays, maxHoldingDays, weightedRateByHolding } from '../taxLot';
import { addDays } from '../../clock';

function mkLot(buyDate: string, qty = 100, cost = 10): TaxLot {
  return {
    id: `lot-${buyDate}`,
    instrumentId: 'TEST',
    buyDate,
    originalBuyDate: buyDate,
    quantity: qty,
    originalQuantity: qty,
    costPerShare: cost,
    costPerShareLocal: cost,
    sourceTxId: `tx-${buyDate}`,
    events: [],
  };
}

describe('FIFO TaxLot 消耗（PRD §3.2.2 / §5.1.2）', () => {
  it('多次买入后部分卖出：按最早批次优先消耗', () => {
    const lotA = mkLot('2026-01-01', 100);
    const lotB = mkLot('2026-02-01', 50);
    const res = consumeFifo([lotA, lotB], 120, 'tx-sell', '2026-03-01');

    expect(res.consumedQty).toBe(120);
    expect(res.remainingQty).toBe(0);
    expect(lotA.quantity).toBe(0); // 第一笔 100 全部消耗
    expect(lotB.quantity).toBe(30); // 第二笔只消耗 20
    expect(lotA.events).toEqual([
      { txId: 'tx-sell', date: '2026-03-01', quantity: -100, type: 'SELL' },
    ]);
    expect(lotB.events).toEqual([
      { txId: 'tx-sell', date: '2026-03-01', quantity: -20, type: 'SELL' },
    ]);
  });

  it('部分卖出未耗尽任何批次：数量按 FIFO 顺序扣减', () => {
    const lotA = mkLot('2026-01-01', 100);
    const lotB = mkLot('2026-02-01', 50);
    const res = consumeFifo([lotA, lotB], 40, 'tx-sell', '2026-03-01');

    expect(res.consumedQty).toBe(40);
    expect(lotA.quantity).toBe(60);
    expect(lotB.quantity).toBe(50);
  });

  it('卖出量超过持仓：只消耗实际持有量并报告剩余未满足量', () => {
    const lotA = mkLot('2026-01-01', 100);
    const res = consumeFifo([lotA], 150, 'tx-sell', '2026-03-01');

    expect(res.consumedQty).toBe(100);
    expect(res.remainingQty).toBe(50);
    expect(lotA.quantity).toBe(0);
  });

  it('零卖出量不影响批次', () => {
    const lotA = mkLot('2026-01-01', 100);
    const res = consumeFifo([lotA], 0, 'tx-sell', '2026-03-01');
    expect(res.consumedQty).toBe(0);
    expect(lotA.quantity).toBe(100);
    expect(lotA.events).toHaveLength(0);
  });
});

describe('送转股 BONUS / 公司行动（PRD §3.2.9）', () => {
  it('送转后数量与成本按比例调整，originalBuyDate 不变', () => {
    const lot = mkLot('2024-03-15', 1000, 20);
    applyCorpAction([lot], 1.5, 'tx-bonus', '2026-04-01', 'BONUS');

    expect(lot.quantity).toBe(1500);
    expect(lot.originalQuantity).toBe(1500);
    expect(lot.costPerShare).toBeCloseTo(20 / 1.5, 6);
    expect(lot.costPerShareLocal).toBeCloseTo(20 / 1.5, 6);
    expect(lot.originalBuyDate).toBe('2024-03-15'); // 持股期限起算日不变
    expect(lot.events).toEqual([
      { txId: 'tx-bonus', date: '2026-04-01', quantity: 500, type: 'BONUS' },
    ]);
  });

  it('拆分 ratio<=0 或非有限值时不修改批次', () => {
    const lot = mkLot('2024-03-15', 1000, 20);
    applyCorpAction([lot], 0, 'tx-bad', '2026-04-01', 'SPLIT');
    applyCorpAction([lot], Number.NaN, 'tx-bad2', '2026-04-01', 'SPLIT');
    expect(lot.quantity).toBe(1000);
    expect(lot.costPerShare).toBe(20);
    expect(lot.events).toHaveLength(0);
  });
});

describe('持股天数与加权税率（A股税档基础）', () => {
  it('holdingDays 从 originalBuyDate 起算（送转沿用原股买入日）', () => {
    const lot = mkLot('2024-03-15', 1000, 20);
    lot.originalBuyDate = '2024-03-15';
    expect(holdingDays(lot, '2025-03-15')).toBe(365);
  });

  it('maxHoldingDays 返回全部批次最大持股天数', () => {
    const lots = [mkLot('2024-03-15'), mkLot('2025-03-15')];
    expect(maxHoldingDays(lots, '2026-03-15')).toBe(730);
    expect(maxHoldingDays([], '2026-03-15')).toBe(0);
  });

  it('weightedRateByHolding 按数量加权', () => {
    const lots = [
      { ...mkLot(addDays('2026-08-04', -10), 100), originalBuyDate: addDays('2026-08-04', -10) }, // 10 天
      { ...mkLot(addDays('2026-08-04', -400), 300), originalBuyDate: addDays('2026-08-04', -400) }, // 400 天
    ];
    const rateFn = (days: number) => (days <= 30 ? 0.2 : days < 365 ? 0.1 : 0);
    // 加权 = (100*0.2 + 300*0)/400 = 0.05
    expect(weightedRateByHolding(lots, '2026-08-04', rateFn)).toBeCloseTo(0.05, 6);
  });
});

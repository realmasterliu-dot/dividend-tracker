import { describe, expect, it } from 'vitest';
import { DataState, Instrument, PriceSnapshot, Transaction } from '@/types';
import { buildTaxLots, derivePositions, priceAtDate, quantityOnDate } from '../position';
import { SEED_TODAY, addDays } from '../../clock';

const TODAY = SEED_TODAY;

function mkInst(over: Partial<Instrument> = {}): Instrument {
  return {
    id: '000001.SZ',
    symbol: '000001.SZ',
    name: '平安银行',
    market: 'A_SHARE',
    currency: 'CNY',
    dividendEligible: true,
    securityType: 'COMMON',
    extraWithholdingRate: 0,
    custodyChannel: 'CN_BROKER',
    ...over,
  };
}

function mkTx(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    instrumentId: '000001.SZ',
    type: 'BUY',
    status: 'CONFIRMED',
    date: '2026-01-01',
    quantity: 100,
    price: 10,
    amount: 1000,
    currency: 'CNY',
    fxRate: 1,
    ...over,
  } as Transaction;
}

function mkPrice(over: Partial<PriceSnapshot> & { id?: string }): PriceSnapshot {
  return {
    instrumentId: '000001.SZ',
    date: TODAY,
    price: 12,
    currency: 'CNY',
    fxRate: 1,
    source: 'test',
    ...over,
  } as PriceSnapshot;
}

const settings = {
  baseCurrency: 'CNY' as const,
  displayCurrency: 'CNY' as const,
  colorScheme: 'CN' as const,
  w8benFilled: false,
  fxNeutralMode: false,
  notificationChannels: {},
  stalenessThresholdHours: 48,
};

describe('PositionEngine（流水 → TaxLot → Position）', () => {
  it('buildTaxLots：BUY 建批次，SELL 按 FIFO 消耗', () => {
    const map = buildTaxLots([
      mkTx({ id: 'buy1', date: '2026-01-01', quantity: 100, price: 10 }),
      mkTx({ id: 'buy2', date: '2026-02-01', quantity: 50, price: 20 }),
      mkTx({ id: 'sell1', type: 'SELL', date: '2026-03-01', quantity: -120 }),
    ]);
    const lots = map.get('000001.SZ')!;
    expect(lots).toHaveLength(1); // 第一批已清空被过滤
    expect(lots[0].quantity).toBe(30);
    expect(lots[0].costPerShare).toBeCloseTo(20, 6);
    expect(lots[0].events[0].quantity).toBe(-20);
  });

  it('buildTaxLots：BONUS 摊薄成本，originalBuyDate 不变', () => {
    const map = buildTaxLots([
      mkTx({ id: 'buy1', date: '2024-03-15', quantity: 1000, price: 20 }),
      mkTx({ id: 'bonus1', date: '2026-04-01', type: 'BONUS', quantity: 0, meta: { ratio: 1.5 } }),
    ]);
    const lots = map.get('000001.SZ')!;
    expect(lots[0].quantity).toBe(1500);
    expect(lots[0].costPerShare).toBeCloseTo(20 / 1.5, 6);
    expect(lots[0].originalBuyDate).toBe('2024-03-15');
  });

  it('buildTaxLots：PENDING 流水不计入持仓', () => {
    const map = buildTaxLots([
      mkTx({ id: 'buy1', date: '2026-01-01', quantity: 100 }),
      mkTx({ id: 'pending1', status: 'PENDING', date: '2026-02-01', quantity: 50 }),
    ]);
    const lots = map.get('000001.SZ')!;
    expect(lots).toHaveLength(1);
    expect(lots[0].quantity).toBe(100);
  });

  it('derivePositions：市值/成本/盈亏正确，含陈旧天数', () => {
    const positions = derivePositions(
      [mkTx({ id: 'buy1', date: '2026-01-01', quantity: 100, price: 10 })],
      [mkInst()],
      [mkPrice({ date: addDays(TODAY, -3), price: 12 })],
      [],
      settings,
    );
    expect(positions).toHaveLength(1);
    const pos = positions[0];
    expect(pos.totalQuantity).toBe(100);
    expect(pos.marketValue).toBeCloseTo(1200, 6);
    expect(pos.costValue).toBeCloseTo(1000, 6);
    expect(pos.unrealizedPnl).toBeCloseTo(200, 6);
    expect(pos.staleDays).toBe(3); // 3 天前价格
  });
});

describe('quantityOnDate / priceAtDate', () => {
  it('quantityOnDate：任意日期的推导数量', () => {
    const txs = [
      mkTx({ id: 'buy1', date: '2026-01-01', quantity: 100 }),
      mkTx({ id: 'sell1', date: '2026-02-01', quantity: -40 }),
      mkTx({ id: 'bonus1', date: '2026-03-01', type: 'BONUS', quantity: 0, meta: { ratio: 2 } }),
    ];
    expect(quantityOnDate('000001.SZ', txs, '2026-01-15')).toBe(100);
    expect(quantityOnDate('000001.SZ', txs, '2026-02-15')).toBe(60);
    expect(quantityOnDate('000001.SZ', txs, '2026-03-15')).toBe(120);
  });

  it('priceAtDate：forward-fill 取最近价格', () => {
    const series = [
      { date: '2026-01-01', price: 10 },
      { date: '2026-01-05', price: 11 },
    ];
    expect(priceAtDate(series, '2026-01-03')).toBe(10);
    expect(priceAtDate(series, '2026-01-06')).toBe(11);
    expect(priceAtDate(series, '2025-12-31')).toBeUndefined();
  });
});

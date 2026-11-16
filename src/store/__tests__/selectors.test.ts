import { describe, expect, it } from 'vitest';
import { DataState, DividendEvent, Instrument, PriceSnapshot, Transaction } from '@/types';
import { derivePortfolio, selectCashflow12m, selectTickerItems } from '../selectors';
import { SEED_TODAY, addDays } from '@/lib/clock';

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
    date: '2025-01-01',
    quantity: 1000,
    price: 10,
    amount: 10000,
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

function mkDiv(over: Partial<DividendEvent> & { id: string }): DividendEvent {
  return {
    instrumentId: '000001.SZ',
    status: 'PAID',
    announceDate: '2025-05-01',
    recordDate: '2025-05-20',
    exDate: '2025-05-21',
    payDate: '2025-05-30',
    payDateEstimated: false,
    perShareAmount: 0.5,
    currency: 'CNY',
    quantityAtRecord: 1000,
    grossAmount: 0,
    taxRateApplied: 0,
    taxWithheld: 0,
    contingentTax: 0,
    netAmount: 0,
    taxBracket: 'NONE',
    dividendForm: 'CASH',
    manual: false,
    sourceKey: 'k',
    ...over,
  } as DividendEvent;
}

function mkState(over: Partial<DataState> = {}): DataState {
  return {
    instruments: [mkInst()],
    transactions: [mkTx({ id: 'buy1' })],
    dividends: [mkDiv({ id: 'd1', status: 'PAID' })],
    plans: [],
    notifications: [],
    prices: [mkPrice({})],
    fx: [],
    lastUpdated: TODAY,
    sourceHealth: {},
    ...over,
  };
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

describe('derivePortfolio 集成（引擎全链路）', () => {
  it('从流水推导出持仓、三态税务、预测、指标', () => {
    const d = derivePortfolio(mkState(), settings);
    expect(d.positions).toHaveLength(1);
    const pos = d.positions[0];
    expect(pos.totalQuantity).toBe(1000);
    expect(pos.marketValue).toBeCloseTo(12000, 6);

    // 三态：A股先派后税，已到账全额 + 或有税负（持股 1年+ → 0%）
    const paid = d.enrichedDividends.find((x) => x.id === 'd1')!;
    expect(paid.grossAmount).toBeCloseTo(500, 6); // 0.5 × 1000
    expect(paid.taxWithheld).toBe(0);
    // ★税档按「今天」的持股期限计算（先派后税：卖出时才补扣）；2025-01-01 建仓已满 1 年 → 免税
    expect(paid.contingentTax).toBe(0);
    expect(paid.netAmount).toBeCloseTo(500, 6);

    expect(d.predictions['000001.SZ']).toBeDefined();
    expect(d.totalMarketValue).toBeCloseTo(12000, 6);
    expect(typeof d.metrics.xirr).toBe('number');
    expect(Number.isFinite(d.metrics.xirr)).toBe(true);
  });

  it('A股或有税负：持股不足 1 年时按 10% 档产生 contingentTax', () => {
    // ★税档以「今天」为基准动态计算，SEED_TODAY 现在是真实系统日期，
    //   买入日必须相对今天构造，否则用例会随时间推移跨档失效。
    const state = mkState({
      transactions: [mkTx({ id: 'buy1', date: addDays(TODAY, -200) })],
      dividends: [mkDiv({
        id: 'd1',
        status: 'PAID',
        recordDate: addDays(TODAY, -40),
        exDate: addDays(TODAY, -39),
        payDate: addDays(TODAY, -30),
      })],
    });
    const d = derivePortfolio(state, settings);
    const paid = d.enrichedDividends.find((x) => x.id === 'd1')!;
    // 持股 200 天 → 1个月-1年 档（10%）
    expect(paid.taxBracket).toBe('M1_1Y');
    expect(paid.taxRateApplied).toBeCloseTo(0.1, 6);
    expect(paid.contingentTax).toBeCloseTo(50, 6);
  });

  it('A股或有税负：持股满 1 年后归零（相对今天构造，不随时间失效）', () => {
    const state = mkState({
      transactions: [mkTx({ id: 'buy1', date: addDays(TODAY, -400) })],
      dividends: [mkDiv({
        id: 'd1',
        status: 'PAID',
        recordDate: addDays(TODAY, -40),
        exDate: addDays(TODAY, -39),
        payDate: addDays(TODAY, -30),
      })],
    });
    const d = derivePortfolio(state, settings);
    const paid = d.enrichedDividends.find((x) => x.id === 'd1')!;
    expect(paid.taxBracket).toBe('GT1Y');
    expect(paid.contingentTax).toBe(0);
    expect(paid.netAmount).toBeCloseTo(500, 6);
  });

  it('selectTickerItems：包含涨跌幅', () => {
    const d = derivePortfolio(mkState(), settings);
    const items = selectTickerItems(mkState(), d.positions);
    expect(items[0].symbol).toBe('000001.SZ');
    expect(typeof items[0].changePct).toBe('number');
  });

  it('selectCashflow12m：已宣告分红计入对应未来月份的 declared 列', () => {
    const state = mkState({
      dividends: [mkDiv({ id: 'd1', status: 'DECLARED', payDate: '2026-09-20', netAmount: 100 })],
    });
    const months = selectCashflow12m(state.dividends);
    const target = months.find((m) => m.month === '2026-09');
    expect(target).toBeDefined();
    expect(target!.declared).toBeGreaterThan(0);
  });

  it('待办：PENDING 流水进入待办区', () => {
    const state = mkState({
      transactions: [
        mkTx({ id: 'buy1' }),
        mkTx({ id: 'pending1', status: 'PENDING', date: TODAY, type: 'BUY', quantity: 10 }),
      ],
    });
    const d = derivePortfolio(state, settings);
    expect(d.pendingTxCount).toBe(1);
    expect(d.todos.some((t) => t.kind === 'PENDING_TX')).toBe(true);
  });
});

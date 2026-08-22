import { describe, expect, it } from 'vitest';
import {
  AppSettings,
  Cashflow,
  DividendEvent,
  Instrument,
  Position,
  Transaction,
} from '@/types';
import { buildSnapshots, enrichPositionsWithDividends } from '../portfolio';
import {
  breakdown,
  realizedIncomeCashflows,
  twr,
  xirr,
  xirrCashflows,
  yoc,
} from '../returns';
import { SEED_TODAY } from '../../clock';

describe('XIRR（PRD §11.3 C7：与 Excel 一致，误差 <0.01%）', () => {
  it('Excel 文档示例：-10000/2750/4250/3250/2750 → 37.3362535%', () => {
    const flows: Cashflow[] = [
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ];
    const result = xirr(flows);
    // 与独立计算 0.3733625335 一致，绝对误差远小于 0.01%
    expect(Math.abs(result - 0.373362535)).toBeLessThan(0.0001);
  });

  it('一年整回报：-1000 → +1100（366 天）≈ 9.9714%', () => {
    const flows: Cashflow[] = [
      { date: '2020-01-01', amount: -1000 },
      { date: '2021-01-01', amount: 1100 },
    ];
    const result = xirr(flows);
    expect(Math.abs(result - 0.0997135859)).toBeLessThan(0.0001);
  });

  it('少于 2 笔现金流返回 0（无有效 IRR）', () => {
    expect(xirr([{ date: '2026-01-01', amount: 100 }])).toBe(0);
    expect(xirr([])).toBe(0);
  });

  it('现金流乱序时按日期排序后再计算', () => {
    const unordered: Cashflow[] = [
      { date: '2021-01-01', amount: 1100 },
      { date: '2020-01-01', amount: -1000 },
    ];
    const result = xirr(unordered);
    expect(Math.abs(result - 0.0997135859)).toBeLessThan(0.0001);
  });
});

describe('xirrCashflows（流水 → 现金流）', () => {
  function mkTx(over: Partial<Transaction>): Transaction {
    return {
      id: 't',
      instrumentId: 'TEST',
      type: 'BUY',
      status: 'CONFIRMED',
      date: '2026-01-01',
      quantity: 10,
      price: 100,
      amount: 1000,
      currency: 'CNY',
      fxRate: 1,
      ...over,
    } as Transaction;
  }

  function mkDividend(over: Partial<DividendEvent>): DividendEvent {
    return {
      id: 'dividend',
      instrumentId: 'TEST',
      status: 'PAID',
      payDate: '2026-03-01',
      payDateEstimated: false,
      perShareAmount: 1,
      currency: 'CNY',
      quantityAtRecord: 100,
      grossAmount: 100,
      taxRateApplied: 0,
      taxWithheld: 0,
      contingentTax: 0,
      netAmount: 100,
      taxBracket: 'NONE',
      dividendForm: 'CASH',
      manual: false,
      sourceKey: 'test-dividend',
      ...over,
    };
  }

  it('BUY 为负流出（含费用）、SELL/DIVIDEND_CASH 为正流入，PENDING 不计入', () => {
    const flows = xirrCashflows(
      [
        mkTx({ id: 'buy1', type: 'BUY', date: '2026-01-01', amount: 1000, fee: 5 }),
        mkTx({ id: 'div1', type: 'DIVIDEND_CASH', date: '2026-03-01', amount: 50 }),
        mkTx({ id: 'pend', type: 'BUY', status: 'PENDING', date: '2026-02-01', amount: 999 }),
      ],
      [],
      1500,
      SEED_TODAY,
    );
    const find = (date: string, amount: number) =>
      flows.find((f) => f.date === date && Math.abs(f.amount - amount) < 1e-9);
    expect(find('2026-01-01', -1005)?.amount).toBe(-1005);
    expect(find('2026-03-01', 50)?.amount).toBe(50);
    // 最终今日市值作为流入
    expect(flows[flows.length - 1]).toEqual({ date: SEED_TODAY, amount: 1500 });
    // 没有 PENDING 产生的 -999
    expect(flows.some((f) => Math.abs(f.amount + 999) < 1e-9)).toBe(false);
  });

  it('管道 PAID 事件即使没有交易流水，也进入 XIRR', () => {
    const flows = xirrCashflows(
      [],
      [mkDividend({ id: 'pipeline', netAmount: 88 })],
      1000,
      SEED_TODAY,
    );

    expect(flows).toContainEqual({ date: '2026-03-01', amount: 88 });
  });

  it('关联现金分红以事件金额为准，不与交易双计', () => {
    const transaction = mkTx({
      id: 'cash',
      type: 'DIVIDEND_CASH',
      amount: 100,
      meta: { dividendEventId: 'pipeline' },
    });
    const income = realizedIncomeCashflows(
      [transaction],
      [mkDividend({ id: 'pipeline', actualReceived: 92, netAmount: 92 })],
    );

    expect(income).toEqual([{ date: '2026-03-01', amount: 92 }]);
  });

  it('红利再投不生成离开组合的现金流，关联事件也不另计一次', () => {
    const reinvest = mkTx({
      id: 'drip',
      type: 'DIVIDEND_REINVEST',
      amount: 100,
      meta: { dividendEventId: 'drip-event' },
    });

    expect(
      realizedIncomeCashflows(
        [reinvest],
        [mkDividend({ id: 'drip-event', netAmount: 100 })],
      ),
    ).toEqual([]);
  });
});

describe('TWR / YOC', () => {
  it('TWR 日链式：无外部流时等于简单回报', () => {
    const snaps = [
      { date: '2026-01-01', marketValue: 100, invested: 100, dividends: 0, isEstimated: true, dataCompleteness: 1 },
      { date: '2026-02-01', marketValue: 110, invested: 100, dividends: 0, isEstimated: true, dataCompleteness: 1 },
    ];
    expect(twr(snaps)).toBeCloseTo(0.1, 6);
  });

  it('TWR 将现金分红加回除息后市值', () => {
    const snaps = [
      { date: '2026-01-01', marketValue: 100, invested: 100, dividends: 0, isEstimated: true, dataCompleteness: 1 },
      { date: '2026-02-01', marketValue: 90, invested: 100, dividends: 0, isEstimated: true, dataCompleteness: 1 },
    ];
    const income = realizedIncomeCashflows(
      [],
      [{
        id: 'cash',
        instrumentId: 'TEST',
        status: 'PAID',
        payDate: '2026-02-01',
        payDateEstimated: false,
        perShareAmount: 1,
        currency: 'CNY',
        quantityAtRecord: 10,
        grossAmount: 10,
        taxRateApplied: 0,
        taxWithheld: 0,
        contingentTax: 0,
        netAmount: 10,
        taxBracket: 'NONE',
        dividendForm: 'CASH',
        manual: false,
        sourceKey: 'cash',
      }],
    );

    expect(twr(snaps, income)).toBeCloseTo(0, 6);
  });

  it('快照不把红利再投当成新增本金', () => {
    const instrument: Instrument = {
      id: 'TEST',
      symbol: 'TEST',
      name: 'Test',
      market: 'A_SHARE',
      currency: 'CNY',
      dividendEligible: true,
      securityType: 'FUND',
      extraWithholdingRate: 0,
      custodyChannel: 'CN_BROKER',
    };
    const settings: AppSettings = {
      baseCurrency: 'CNY',
      displayCurrency: 'CNY',
      colorScheme: 'CN',
      w8benFilled: true,
      fxNeutralMode: false,
      notificationChannels: {},
      stalenessThresholdHours: 48,
    };
    const buy = {
      id: 'buy', instrumentId: 'TEST', type: 'BUY', status: 'CONFIRMED',
      date: '2026-01-01', quantity: 10, price: 10, amount: 100,
      currency: 'CNY', fxRate: 1,
    } satisfies Transaction;
    const reinvest = {
      id: 'drip', instrumentId: 'TEST', type: 'DIVIDEND_REINVEST', status: 'CONFIRMED',
      date: '2026-02-01', quantity: 1, price: 10, amount: 10,
      currency: 'CNY', fxRate: 1,
    } satisfies Transaction;
    const snaps = buildSnapshots(
      [buy, reinvest],
      [instrument],
      [
        { instrumentId: 'TEST', date: '2026-01-01', price: 10, currency: 'CNY', fxRate: 1, source: 'test' },
        { instrumentId: 'TEST', date: '2026-02-01', price: 10, currency: 'CNY', fxRate: 1, source: 'test' },
      ],
      [],
      settings,
      '2026-02-01',
    );

    expect(snaps.at(-1)?.invested).toBe(100);
    expect(twr(snaps)).toBeCloseTo(0.1, 6);
  });

  it('YOC：成本股息率 = TTM 分红 / 成本', () => {
    expect(yoc(30, 1000)).toBeCloseTo(0.03, 6);
    expect(yoc(30, 0)).toBe(0);
  });
});

describe('三段回报拆解（PRD §7.4：总和 = 总回报）', () => {
  function mkPos(over: Partial<Position>): Position {
    return {
      instrumentId: 'X',
      instrument: {
        id: 'X',
        symbol: 'X',
        name: 'X',
        market: 'US',
        currency: 'USD',
        dividendEligible: true,
        securityType: 'COMMON',
        extraWithholdingRate: 0,
        custodyChannel: 'US_BROKER',
      },
      lots: [],
      totalQuantity: 100,
      avgCostPerShare: 7,
      avgCostPerShareLocal: 1,
      marketPrice: 1.2,
      prevPrice: 1.1,
      fxRate: 7.2,
      marketValue: 864,
      costValue: 700,
      costValueCurrentFx: 720,
      unrealizedPnl: 164,
      unrealizedPnlPct: 0.2343,
      weightPct: 1,
      ttmDividend: 10,
      dividendYield: 0.01,
      incomeYield: 0.01,
      yoc: 0.014,
      annualDividend: 10,
      staleDays: 0,
      ...over,
    } as Position;
  }

  it('价格 + 汇兑 + 分红 = 总回报', () => {
    const bd = breakdown([mkPos({})], [], [], {
      baseCurrency: 'CNY',
      displayCurrency: 'CNY',
      colorScheme: 'CN',
      w8benFilled: true,
      fxNeutralMode: false,
      notificationChannels: {},
      stalenessThresholdHours: 48,
    });
    expect(bd.price).toBeCloseTo(864 - 720, 6); // 当前汇率口径价格回报
    expect(bd.fx).toBeCloseTo(720 - 700, 6); // 汇兑回报
    expect(bd.dividend).toBe(0);
    expect(Math.abs(bd.total - (bd.price + bd.fx + bd.dividend))).toBeLessThan(1e-9);
  });

  it('汇率中性模式：汇兑回报强制为 0', () => {
    const bd = breakdown([mkPos({})], [], [], {
      baseCurrency: 'CNY',
      displayCurrency: 'CNY',
      colorScheme: 'CN',
      w8benFilled: true,
      fxNeutralMode: true,
      notificationChannels: {},
      stalenessThresholdHours: 48,
    });
    expect(bd.fx).toBe(0);
  });

  it('同日手工实际到账替代多条管道估算，收益拆解与 TTM 均不重复', () => {
    const baseDividend: DividendEvent = {
      id: 'pipeline-regular',
      instrumentId: 'X',
      status: 'PAID',
      payDate: SEED_TODAY,
      payDateEstimated: false,
      perShareAmount: 1,
      currency: 'USD',
      quantityAtRecord: 1,
      grossAmount: 10,
      taxRateApplied: 0,
      taxWithheld: 0,
      contingentTax: 0,
      netAmount: 10,
      taxBracket: 'NONE',
      dividendForm: 'CASH',
      manual: false,
      sourceKey: 'pipeline-regular',
    };
    const dividends: DividendEvent[] = [
      baseDividend,
      { ...baseDividend, id: 'pipeline-special', netAmount: 5, sourceKey: 'pipeline-special' },
      {
        ...baseDividend,
        id: 'manual-receipt',
        status: 'RECONCILED',
        netAmount: 12,
        actualReceived: 12,
        manual: true,
        sourceKey: 'manual-transaction:cash',
      },
    ];
    const settings: AppSettings = {
      baseCurrency: 'CNY',
      displayCurrency: 'CNY',
      colorScheme: 'CN',
      w8benFilled: true,
      fxNeutralMode: false,
      notificationChannels: {},
      stalenessThresholdHours: 48,
    };

    expect(breakdown([mkPos({})], [], dividends, settings).dividend).toBe(12);
    expect(enrichPositionsWithDividends([mkPos({})], dividends, {}).at(0)?.ttmDividend).toBe(12);
  });
});

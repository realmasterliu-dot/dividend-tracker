import { describe, expect, it } from 'vitest';
import { DataState, DividendEvent, Instrument, PriceSnapshot, Transaction } from '@/types';
import { generate, dedupKey, nextRunAfter } from '../notification';
import { SEED_TODAY, addDays } from '../clock';

function mkInst(over: Partial<Instrument> = {}): Instrument {
  return {
    id: 'AAPL',
    symbol: 'AAPL',
    name: '苹果',
    market: 'US',
    currency: 'USD',
    dividendEligible: true,
    securityType: 'COMMON',
    extraWithholdingRate: 0,
    custodyChannel: 'US_BROKER',
    ...over,
  };
}

function mkState(over: Partial<DataState> = {}): DataState {
  return {
    instruments: [mkInst()],
    transactions: [],
    dividends: [],
    plans: [],
    notifications: [],
    prices: [],
    fx: [],
    lastUpdated: SEED_TODAY,
    sourceHealth: {},
    ...over,
  };
}

describe('通知去重（PRD §5.7.3：重跑不重复推送）', () => {
  it('dedupKey 组合 标的+类型+日期', () => {
    expect(dedupKey('PAY_DATE', 'AAPL', '2026-08-20')).toBe('AAPL|PAY_DATE|2026-08-20');
  });

  it('已存在相同 key 的通知不重复生成', () => {
    const proposed: DividendEvent = {
      id: 'd1',
      instrumentId: 'AAPL',
      status: 'PROPOSED',
      announceDate: '2026-08-01',
      payDateEstimated: true,
      perShareAmount: 1,
      currency: 'USD',
      quantityAtRecord: 10,
      grossAmount: 10,
      taxRateApplied: 0.3,
      taxWithheld: 3,
      contingentTax: 0,
      netAmount: 7,
      taxBracket: 'NONE',
      dividendForm: 'CASH',
      manual: false,
      sourceKey: 'AAPL|DIVIDEND_PROPOSED|2026-08-01',
    };
    const state = mkState({
      dividends: [proposed],
      notifications: [
        {
          id: 'existing',
          key: 'AAPL|DIVIDEND_PROPOSED|2026-08-01',
          type: 'DIVIDEND_PROPOSED',
          title: 'x',
          body: 'y',
          severity: 'INFO',
          createdAt: SEED_TODAY,
          read: false,
        },
      ],
    });
    const out = generate(state, 48, SEED_TODAY);
    expect(out.some((n) => n.type === 'DIVIDEND_PROPOSED')).toBe(false);
  });

  it('PROPOSED 触发 DIVIDEND_PROPOSED 通知', () => {
    const proposed: DividendEvent = {
      id: 'd1',
      instrumentId: 'AAPL',
      status: 'PROPOSED',
      announceDate: '2026-08-01',
      payDateEstimated: true,
      perShareAmount: 1,
      currency: 'USD',
      quantityAtRecord: 10,
      grossAmount: 10,
      taxRateApplied: 0.3,
      taxWithheld: 3,
      contingentTax: 0,
      netAmount: 7,
      taxBracket: 'NONE',
      dividendForm: 'CASH',
      manual: false,
      sourceKey: 'k1',
    };
    const out = generate(mkState({ dividends: [proposed] }), 48, SEED_TODAY);
    expect(out.some((n) => n.type === 'DIVIDEND_PROPOSED')).toBe(true);
  });

  // ★DATA_STALE 已改为交易日口径（clock.tradingDaysBetween），
  //   用例必须锚定固定星期几，不能用「今天 - N 个日历天」——否则周日/周一跑测试会假失败。
  it('数据陈旧超过阈值触发 DATA_STALE（周五行情 → 周二已 2 个交易日）', () => {
    const friday = '2026-07-31';
    const tuesday = '2026-08-04';
    const prices: PriceSnapshot[] = [
      { instrumentId: 'AAPL', date: friday, price: 200, currency: 'USD', fxRate: 7.2, source: 'yf' },
    ];
    const out = generate(mkState({ prices }), 48, tuesday);
    expect(out.some((n) => n.type === 'DATA_STALE')).toBe(true);
  });

  it('周末隔夜不误报：周五行情在周一仅 1 个交易日，不触发 DATA_STALE', () => {
    const friday = '2026-08-07';
    const monday = '2026-08-10';
    const prices: PriceSnapshot[] = [
      { instrumentId: 'AAPL', date: friday, price: 200, currency: 'USD', fxRate: 7.2, source: 'yf' },
    ];
    const out = generate(mkState({ prices }), 48, monday);
    expect(out.some((n) => n.type === 'DATA_STALE')).toBe(false);
  });

  it('长假停更仍会告警：连续 3 个交易日无新行情', () => {
    const prices: PriceSnapshot[] = [
      { instrumentId: 'AAPL', date: '2026-08-03', price: 200, currency: 'USD', fxRate: 7.2, source: 'yf' },
    ];
    const out = generate(mkState({ prices }), 48, '2026-08-06');
    const stale = out.find((n) => n.type === 'DATA_STALE')!;
    expect(stale).toBeDefined();
    expect(stale.body).toContain('3 个交易日');
  });
});

describe('定投排期（PRD §5.4）', () => {
  it('nextRunAfter 每日/每周/双周/每月', () => {
    expect(nextRunAfter('2026-08-04', 'DAILY', 0)).toBe('2026-08-05');
    expect(nextRunAfter('2026-08-04', 'WEEKLY', 0)).toBe('2026-08-11');
    expect(nextRunAfter('2026-08-04', 'BIWEEKLY', 0)).toBe('2026-08-18');
    expect(nextRunAfter('2026-08-04', 'MONTHLY', 15)).toBe('2026-09-15');
  });

  it('nextRunAfter MONTHLY 31 号在小月 clamp 到月末（Bug-1 回归 + PRD §5.4 月末策略）', () => {
    // 9 月只有 30 天 → 顺延至 9-30
    expect(nextRunAfter('2026-08-04', 'MONTHLY', 31)).toBe('2026-09-30');
    // 2026 年 2 月只有 28 天 → 顺延至 2-28
    expect(nextRunAfter('2026-01-15', 'MONTHLY', 31)).toBe('2026-02-28');
    // 大月不 clamp：1 月有 31 天 → 1-31
    expect(nextRunAfter('2026-12-15', 'MONTHLY', 31)).toBe('2027-01-31');
  });

  it('nextRunAfter MONTHLY 时区安全：本地构造 + 本地格式化，无 UTC 偏移（Bug-1 回归）', () => {
    // 该断言在 TZ=America/New_York 与 TZ=Asia/Shanghai 下均应为 2026-09-15
    expect(nextRunAfter('2026-08-04', 'MONTHLY', 15)).toBe('2026-09-15');
  });
});

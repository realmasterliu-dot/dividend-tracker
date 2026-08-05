import { describe, expect, it } from 'vitest';
import { AppSettings, DataState, Instrument, PriceSnapshot, Transaction } from '@/types';
import { addDays, daysBetween, todayISO, tradingDaysBetween } from '@/lib/clock';
import { generate } from '@/lib/notification';
import { derivePortfolio } from '../selectors';

/**
 * 行情陈旧判定改为「交易日」口径（selectors.isPositionStale + notification.DATA_STALE）
 *
 * 动机：每日管道在周末与隔夜不产出新行情，日历日口径会把常态误报为数据陈旧。
 * 断言不依赖「今天是星期几」——通过反查满足指定交易日间隔的价格日期来构造用例。
 */

const TODAY = todayISO();

/** 反查：距今恰好 gap 个交易日的价格日期（保证用例在任意星期几都成立） */
function priceDateWithTradingGap(gap: number): string {
  for (let back = 0; back <= 40; back++) {
    const candidate = addDays(TODAY, -back);
    if (tradingDaysBetween(candidate, TODAY) === gap) return candidate;
  }
  throw new Error(`未找到距今 ${gap} 个交易日的日期`);
}

const instrument: Instrument = {
  id: '000001.SZ',
  symbol: '000001.SZ',
  name: '平安银行',
  market: 'A_SHARE',
  currency: 'CNY',
  dividendEligible: true,
  securityType: 'COMMON',
  extraWithholdingRate: 0,
  custodyChannel: 'CN_BROKER',
};

const transaction: Transaction = {
  id: 'tx-buy',
  instrumentId: '000001.SZ',
  type: 'BUY',
  status: 'CONFIRMED',
  date: '2024-01-01',
  quantity: 1000,
  price: 10,
  amount: 10000,
  currency: 'CNY',
  fxRate: 1,
};

function mkSettings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    baseCurrency: 'CNY',
    displayCurrency: 'CNY',
    colorScheme: 'CN',
    w8benFilled: false,
    fxNeutralMode: false,
    notificationChannels: {},
    stalenessThresholdHours: 48,
    ...over,
  };
}

function mkState(priceDate: string | null): DataState {
  const prices: PriceSnapshot[] =
    priceDate === null
      ? []
      : [{ instrumentId: '000001.SZ', date: priceDate, price: 12, currency: 'CNY', fxRate: 1, source: 'akshare' }];
  return {
    instruments: [instrument],
    transactions: [transaction],
    dividends: [],
    plans: [],
    notifications: [],
    prices,
    fx: [],
    lastUpdated: `${TODAY}T04:00:00Z`,
    sourceHealth: {},
  };
}

describe('isPositionStale（交易日口径 + stalenessThresholdHours 阈值）', () => {
  it('当日行情 → 不陈旧', () => {
    const d = derivePortfolio(mkState(TODAY), mkSettings());
    expect(d.positions[0].staleDays).toBe(0);
    expect(d.staleCount).toBe(0);
    expect(d.todos.some((t) => t.kind === 'DATA_STALE')).toBe(false);
  });

  it('★距今 1 个交易日（含周末隔夜）→ 48h 阈值下不告警', () => {
    const priceDate = priceDateWithTradingGap(1);
    const d = derivePortfolio(mkState(priceDate), mkSettings({ stalenessThresholdHours: 48 }));
    expect(tradingDaysBetween(priceDate, TODAY)).toBe(1);
    expect(d.staleCount).toBe(0);
    expect(d.todos.some((t) => t.kind === 'DATA_STALE')).toBe(false);
  });

  it('距今 2 个交易日 → 48h 阈值下告警', () => {
    const priceDate = priceDateWithTradingGap(2);
    const d = derivePortfolio(mkState(priceDate), mkSettings({ stalenessThresholdHours: 48 }));
    expect(d.staleCount).toBe(1);
    expect(d.todos.some((t) => t.kind === 'DATA_STALE')).toBe(true);
  });

  it('阈值可配：24h 阈值下 1 个交易日即告警', () => {
    const priceDate = priceDateWithTradingGap(1);
    const d = derivePortfolio(mkState(priceDate), mkSettings({ stalenessThresholdHours: 24 }));
    expect(d.staleCount).toBe(1);
  });

  it('阈值放宽到 72h 时 2 个交易日不告警', () => {
    const priceDate = priceDateWithTradingGap(2);
    const d = derivePortfolio(mkState(priceDate), mkSettings({ stalenessThresholdHours: 72 }));
    expect(d.staleCount).toBe(0);
  });

  it('完全没有行情快照 → 视为陈旧（staleDays 兜底 99）', () => {
    const d = derivePortfolio(mkState(null), mkSettings());
    expect(d.positions[0].staleDays).toBe(99);
    expect(d.staleCount).toBe(1);
  });

  it('待办文案仍用日历天展示「N天前」，仅告警判定用交易日', () => {
    const priceDate = priceDateWithTradingGap(2);
    const calendarDays = daysBetween(priceDate, TODAY);
    const d = derivePortfolio(mkState(priceDate), mkSettings());
    const todo = d.todos.find((t) => t.kind === 'DATA_STALE')!;
    expect(todo.detail).toContain(`${calendarDays}天前`);
  });
});

describe('DATA_STALE 通知与 selectors 判定口径一致', () => {
  it('1 个交易日：两侧均不告警', () => {
    const priceDate = priceDateWithTradingGap(1);
    const state = mkState(priceDate);
    const d = derivePortfolio(state, mkSettings());
    const notifications = generate(state, 48, TODAY);
    expect(d.staleCount).toBe(0);
    expect(notifications.some((n) => n.type === 'DATA_STALE')).toBe(false);
  });

  it('2 个交易日：两侧均告警', () => {
    const priceDate = priceDateWithTradingGap(2);
    const state = mkState(priceDate);
    const d = derivePortfolio(state, mkSettings());
    const notifications = generate(state, 48, TODAY);
    expect(d.staleCount).toBe(1);
    expect(notifications.some((n) => n.type === 'DATA_STALE')).toBe(true);
  });
});

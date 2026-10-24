import { describe, expect, it } from 'vitest';
import { DataState, Instrument, Notification, Transaction } from '@/types';
import { buildPersonalState } from '@/data';
import { mergeAnonymousLedgerForLogin, reducer } from '../DataContext';
import type { LedgerPayload } from '@/data/cloud/types';
import {
  AddHoldingForm,
  buildInitialBuy,
  buildInstrumentFromForm,
} from '@/components/holdings/AddHoldingModal';

/**
 * reducer 纯函数单测 + 新增持仓构造器测试。
 *
 * 覆盖本次新增的三个 action：
 * - ADD_INSTRUMENT：新增标的，同 id 已存在则忽略（新增 ≠ 覆盖）
 * - UPSERT_INSTRUMENT：存在则覆盖、不存在则追加
 * - CLEAR_PERSONAL_DATA：清空个人数据三切片，保留市场数据（不白屏）
 * 以及 AddHoldingModal 暴露的纯构造器 buildInstrumentFromForm / buildInitialBuy。
 */

/** 基线 state：个人数据取种子，行情/汇率/分红塞入非空值以便断言「清空不洗掉市场数据」 */
function baseState(): DataState {
  return {
    ...buildPersonalState(),
    prices: [
      { instrumentId: 'X', date: '2026-01-01', price: 1, currency: 'CNY', fxRate: 1, source: 's' },
    ],
    fx: [{ date: '2026-01-01', rates: { USDCNY: 7 } }],
  };
}

function makeInstrument(id: string, name: string): Instrument {
  return {
    id,
    symbol: id,
    name,
    market: 'A_SHARE',
    currency: 'CNY',
    dividendEligible: true,
    securityType: 'COMMON',
    extraWithholdingRate: 0,
    custodyChannel: 'CN_BROKER',
  };
}

describe('reducer · ADD_INSTRUMENT', () => {
  it('追加新标的，且不修改入参 state', () => {
    const base = baseState();
    const instrument = makeInstrument('NEW.SH', '新标的');
    const next = reducer(base, { type: 'ADD_INSTRUMENT', payload: instrument });

    expect(next.instruments).toHaveLength(base.instruments.length + 1);
    expect(next.instruments[next.instruments.length - 1]).toEqual(instrument);
    expect(base.instruments).toHaveLength(7); // 种子基线未变
  });

  it('同 id 已存在 → 原样返回该 state（避免持仓表出现两行同标的）', () => {
    const base = baseState();
    const existing = base.instruments[0];
    const next = reducer(base, { type: 'ADD_INSTRUMENT', payload: existing });

    expect(next).toBe(base);
  });
});

describe('reducer · UPSERT_INSTRUMENT', () => {
  it('不存在则追加', () => {
    const base = baseState();
    const instrument = makeInstrument('NEW.SH', '新标的');
    const next = reducer(base, { type: 'UPSERT_INSTRUMENT', payload: instrument });

    expect(next.instruments).toHaveLength(base.instruments.length + 1);
    expect(next.instruments.some((i) => i.id === 'NEW.SH')).toBe(true);
  });

  it('已存在则按 id 覆盖字段', () => {
    const base = baseState();
    const existing = base.instruments[0];
    const updated = { ...existing, name: '改名后', dividendEligible: false };
    const next = reducer(base, { type: 'UPSERT_INSTRUMENT', payload: updated });

    expect(next.instruments).toHaveLength(base.instruments.length);
    const found = next.instruments.find((i) => i.id === existing.id)!;
    expect(found.name).toBe('改名后');
    expect(found.dividendEligible).toBe(false);
  });
});

describe('reducer · CLEAR_PERSONAL_DATA', () => {
  it('三切片清空，市场数据（prices/fx/dividends）原样保留不白屏', () => {
    const base = baseState();
    const next = reducer(base, { type: 'CLEAR_PERSONAL_DATA' });

    expect(next.instruments).toEqual([]);
    expect(next.transactions).toEqual([]);
    expect(next.plans).toEqual([]);
    // ★市场数据保留（引用不变 → 图表/市值仍可计算）
    expect(next.prices).toBe(base.prices);
    expect(next.fx).toBe(base.fx);
    expect(next.dividends).toBe(base.dividends);
  });

  it('不修改入参（纯函数约束）', () => {
    const base = baseState();
    const snapshot = JSON.stringify(base);
    reducer(base, { type: 'CLEAR_PERSONAL_DATA' });
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe('reducer · CONFIRM_PENDING', () => {
  const pending: Transaction = {
    id: 'pending-dca',
    instrumentId: '110011',
    type: 'BUY',
    status: 'PENDING',
    date: '2026-08-12',
    quantity: 0,
    price: 0,
    amount: 1000,
    currency: 'CNY',
    fxRate: 1,
    source: 'DCA',
  };

  it('未提供真实成交份额时保持待确认，禁止 0 份交易入账', () => {
    const base = { ...baseState(), transactions: [pending] };
    const next = reducer(base, { type: 'CONFIRM_PENDING', payload: { id: pending.id } });
    expect(next.transactions[0]).toEqual(pending);
  });

  it('正数成交份额才确认，并由计划金额反推成交价', () => {
    const base = { ...baseState(), transactions: [pending] };
    const next = reducer(base, {
      type: 'CONFIRM_PENDING',
      payload: { id: pending.id, actualQuantity: 812.5 },
    });
    expect(next.transactions[0].status).toBe('CONFIRMED');
    expect(next.transactions[0].quantity).toBe(812.5);
    expect(next.transactions[0].price).toBeCloseTo(1000 / 812.5);
  });
});

describe('reducer · GENERATE_DCA_TX', () => {
  it('stores the supplied transaction-date FX rate for a foreign-currency plan', () => {
    const instrument: Instrument = {
      ...makeInstrument('AAPL', 'Apple'),
      market: 'US',
      currency: 'USD',
      custodyChannel: 'US_BROKER',
    };
    const base = {
      ...baseState(),
      instruments: [instrument],
      transactions: [],
      plans: [{
        id: 'usd-plan',
        instrumentId: instrument.id,
        amount: 100,
        frequency: 'MONTHLY' as const,
        executionDay: 12,
        startDate: '2026-08-12',
        holidayPolicy: 'NEXT_TRADING_DAY' as const,
        monthEndPolicy: 'LAST_TRADING_DAY' as const,
        autoConfirm: false,
        status: 'ACTIVE' as const,
      }],
    };

    const next = reducer(base, {
      type: 'GENERATE_DCA_TX',
      payload: { planId: 'usd-plan', date: '2026-08-12', fxRate: 7.18 },
    });

    expect(next.transactions).toHaveLength(1);
    expect(next.transactions[0]).toMatchObject({ currency: 'USD', fxRate: 7.18, status: 'PENDING' });
  });
});

describe('reducer · DELETE_TRANSACTION', () => {
  it('deleting a cash-dividend transaction also removes its linked manual dividend event', () => {
    const base = baseState();
    const transaction: Transaction = {
      id: 'cash-dividend',
      instrumentId: base.instruments[0].id,
      type: 'DIVIDEND_CASH',
      status: 'CONFIRMED',
      date: '2026-08-12',
      quantity: 0,
      price: 0,
      amount: 100,
      currency: 'CNY',
      fxRate: 1,
      meta: { dividendEventId: 'manual-event' },
    };
    const manualEvent = {
      ...base.dividends[0],
      id: 'manual-event',
      manual: true,
    };
    const next = reducer(
      { ...base, transactions: [transaction], dividends: [manualEvent] },
      { type: 'DELETE_TRANSACTION', payload: { id: transaction.id } },
    );
    expect(next.transactions).toEqual([]);
    expect(next.dividends).toEqual([]);
  });

  it('does not delete a linked pipeline event when removing its transaction correction', () => {
    const base = baseState();
    const pipelineEvent = {
      ...base.dividends[0],
      id: 'pipeline-event',
      manual: false,
      status: 'RECONCILED' as const,
      actualReceived: 100,
      netAmount: 100,
    };
    const transaction: Transaction = {
      id: 'cash-dividend',
      instrumentId: pipelineEvent.instrumentId,
      type: 'DIVIDEND_CASH',
      status: 'CONFIRMED',
      date: '2026-08-12',
      quantity: 0,
      price: 0,
      amount: 100,
      currency: 'CNY',
      fxRate: 1,
      meta: { dividendEventId: pipelineEvent.id },
    };
    const next = reducer(
      { ...base, transactions: [transaction], dividends: [pipelineEvent] },
      { type: 'DELETE_TRANSACTION', payload: { id: transaction.id } },
    );
    expect(next.dividends).toHaveLength(1);
    expect(next.dividends[0]).toMatchObject({ id: pipelineEvent.id, manual: false });
    expect(next.dividends[0].actualReceived).toBeUndefined();
    expect(next.dividends[0].status).toBe('PAID');
  });

  it('editing a cash receipt onto a new event restores the old pipeline event', () => {
    const base = baseState();
    const pipelineEvent = {
      ...base.dividends[0],
      id: 'old-pipeline-event',
      manual: false,
      status: 'RECONCILED' as const,
      actualReceived: 100,
      netAmount: 100,
    };
    const newManualEvent = {
      ...pipelineEvent,
      id: 'new-manual-event',
      instrumentId: 'MSFT',
      manual: true,
      sourceKey: 'manual-transaction:cash-dividend',
    };
    const transaction: Transaction = {
      id: 'cash-dividend',
      instrumentId: pipelineEvent.instrumentId,
      type: 'DIVIDEND_CASH',
      status: 'CONFIRMED',
      date: '2026-08-12',
      quantity: 0,
      price: 0,
      amount: 100,
      currency: 'CNY',
      fxRate: 1,
      meta: { dividendEventId: pipelineEvent.id },
    };
    const next = reducer(
      {
        ...base,
        transactions: [transaction],
        dividends: [pipelineEvent, newManualEvent],
      },
      {
        type: 'UPDATE_TRANSACTION',
        payload: {
          id: transaction.id,
          patch: {
            instrumentId: 'MSFT',
            meta: { dividendEventId: newManualEvent.id },
          },
        },
      },
    );

    expect(next.dividends.find((item) => item.id === pipelineEvent.id)).toMatchObject({
      status: 'PAID',
      manual: false,
    });
    expect(next.dividends.find((item) => item.id === pipelineEvent.id)?.actualReceived).toBeUndefined();
    expect(next.dividends.find((item) => item.id === newManualEvent.id)).toBeDefined();
  });
});

describe('reducer · REPLACE_LEDGER notifications', () => {
  const notification = (
    id: string,
    key: string,
    title: string,
    read = false,
  ): Notification => ({
    id,
    key,
    type: 'DATA_STALE',
    title,
    body: title,
    severity: 'INFO',
    createdAt: '2026-08-12T00:00:00.000Z',
    read,
  });

  it('applies durable cloud edits and deletions while retaining device-local generated items', () => {
    const base = baseState();
    const generated = notification('gen-local', 'generated', '本机行情提醒');
    const deletedDurable = notification('manual-old', 'old', '应被远端删除');
    const editedDurable = notification('manual-edit', 'edit', '旧文案');
    const remoteEdited = notification('manual-edit', 'edit', '新文案');
    const remoteAdded = notification('manual-new', 'new', '远端新增');
    const next = reducer(
      { ...base, notifications: [generated, deletedDurable, editedDurable] },
      {
        type: 'REPLACE_LEDGER',
        payload: {
          schemaVersion: 1,
          instruments: base.instruments,
          transactions: base.transactions,
          plans: base.plans,
          dividends: [],
          notifications: [remoteEdited, remoteAdded],
          settings: {
            baseCurrency: 'CNY',
            displayCurrency: 'CNY',
            colorScheme: 'CN',
            w8benFilled: false,
            fxNeutralMode: false,
            notificationChannels: {},
            stalenessThresholdHours: 48,
          },
          updatedAt: '2026-08-12T00:00:00.000Z',
        },
      },
    );

    expect(next.notifications.map((item) => item.id)).toEqual([
      'gen-local',
      'manual-edit',
      'manual-new',
    ]);
    expect(next.notifications.find((item) => item.id === 'manual-edit')?.title).toBe('新文案');
  });

  it('never rolls a durable notification from read back to unread', () => {
    const base = baseState();
    const localRead = notification('manual-read', 'same-key', '本机', true);
    const remoteUnread = notification('manual-read', 'same-key', '云端更新', false);
    const next = reducer(
      { ...base, notifications: [localRead] },
      {
        type: 'REPLACE_LEDGER',
        payload: {
          schemaVersion: 1,
          instruments: base.instruments,
          transactions: base.transactions,
          plans: base.plans,
          dividends: [],
          notifications: [remoteUnread],
          settings: {
            baseCurrency: 'CNY',
            displayCurrency: 'CNY',
            colorScheme: 'CN',
            w8benFilled: false,
            fxNeutralMode: false,
            notificationChannels: {},
            stalenessThresholdHours: 48,
          },
          updatedAt: '2026-08-12T00:00:00.000Z',
        },
      },
    );

    expect(next.notifications).toHaveLength(1);
    expect(next.notifications[0]).toMatchObject({ title: '云端更新', read: true });
  });

  it('restores a calibrated pipeline dividend even before its market row is available', () => {
    const base = { ...baseState(), dividends: [] };
    const corrected = {
      ...baseState().dividends[0],
      id: 'orphaned-pipeline-correction',
      manual: false,
      status: 'RECONCILED' as const,
      actualReceived: 88,
      taxWithheldOverride: 2,
      netAmount: 88,
    };
    const next = reducer(base, {
      type: 'IMPORT_LEDGER',
      payload: {
        schemaVersion: 1,
        instruments: base.instruments,
        transactions: base.transactions,
        plans: base.plans,
        dividends: [corrected],
        notifications: [],
        settings: {
          baseCurrency: 'CNY',
          displayCurrency: 'CNY',
          colorScheme: 'CN',
          w8benFilled: false,
          fxNeutralMode: false,
          notificationChannels: {},
          stalenessThresholdHours: 48,
        },
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    });

    expect(next.dividends).toContainEqual(corrected);
  });
});

describe('cloud login · anonymous ledger migration', () => {
  const ledger = (
    instruments: Instrument[],
    transactions: Transaction[],
    updatedAt: string,
  ): LedgerPayload => ({
    schemaVersion: 1,
    instruments,
    transactions,
    plans: [],
    dividends: [],
    notifications: [],
    settings: {
      baseCurrency: 'CNY',
      displayCurrency: 'CNY',
      colorScheme: 'CN',
      w8benFilled: false,
      fxNeutralMode: false,
      notificationChannels: {},
      stalenessThresholdHours: 48,
    },
    updatedAt,
  });

  it('keeps owner records and adds anonymous records when signing into an existing ledger', () => {
    const ownerInstrument = makeInstrument('OWNER.SH', '云端持仓');
    const anonymousInstrument = makeInstrument('LOCAL.SH', '未登录持仓');
    const ownerTx: Transaction = {
      id: 'owner-tx', instrumentId: ownerInstrument.id, type: 'BUY', status: 'CONFIRMED',
      date: '2026-08-01', quantity: 1, price: 10, amount: 10, currency: 'CNY', fxRate: 1,
    };
    const anonymousTx: Transaction = {
      id: 'local-tx', instrumentId: anonymousInstrument.id, type: 'BUY', status: 'CONFIRMED',
      date: '2026-08-12', quantity: 2, price: 20, amount: 40, currency: 'CNY', fxRate: 1,
    };

    const merged = mergeAnonymousLedgerForLogin(
      ledger([ownerInstrument], [ownerTx], '2026-08-01T00:00:00.000Z'),
      ledger([anonymousInstrument], [anonymousTx], '2026-08-12T00:00:00.000Z'),
    );

    expect(merged.instruments.map((item) => item.id)).toEqual(['LOCAL.SH', 'OWNER.SH']);
    expect(merged.transactions.map((item) => item.id)).toEqual(['local-tx', 'owner-tx']);
  });

  it('uses an anonymous ledger directly when the owner has no records', () => {
    const anonymousInstrument = makeInstrument('LOCAL.SH', '未登录持仓');
    const anonymous = ledger([anonymousInstrument], [], '2026-08-12T00:00:00.000Z');
    const merged = mergeAnonymousLedgerForLogin(
      ledger([], [], '2026-08-01T00:00:00.000Z'),
      anonymous,
    );
    expect(merged.instruments).toEqual([anonymousInstrument]);
  });
});

describe('AddHoldingModal · buildInstrumentFromForm', () => {
  const form: AddHoldingForm = {
    code: ' 600519.SH ',
    name: ' 贵州茅台 ',
    market: 'A_SHARE',
    currency: 'CNY',
    dividendEligible: true,
    securityType: 'COMMON',
    custodyChannel: 'CN_BROKER',
    tags: '核心持仓, 白酒',
    enableFirstBuy: false,
    buyDate: '',
    buyQuantity: '',
    buyPrice: '',
    buyCurrency: 'CNY',
    buyFxRate: '1',
    buyNote: '',
  };

  it('code 归一为 id 与 symbol（trim），名称 trim，tags 逗号拆分', () => {
    const inst = buildInstrumentFromForm(form);
    expect(inst.id).toBe('600519.SH');
    expect(inst.symbol).toBe('600519.SH');
    expect(inst.name).toBe('贵州茅台');
    expect(inst.currency).toBe('CNY');
    expect(inst.dividendEligible).toBe(true);
    expect(inst.tags).toEqual(['核心持仓', '白酒']);
  });

  it('空 tags → 不挂 tags 字段', () => {
    const inst = buildInstrumentFromForm({ ...form, tags: '  ,  ,' });
    expect(inst.tags).toBeUndefined();
  });
});

describe('AddHoldingModal · buildInitialBuy', () => {
  const form: AddHoldingForm = {
    code: '600519.SH',
    name: '贵州茅台',
    market: 'A_SHARE',
    currency: 'CNY',
    dividendEligible: true,
    securityType: 'COMMON',
    custodyChannel: 'CN_BROKER',
    tags: '',
    enableFirstBuy: true,
    buyDate: '2026-01-01',
    buyQuantity: '100',
    buyPrice: '1700',
    buyCurrency: 'CNY',
    buyFxRate: '1',
    buyNote: '建仓',
  };

  it('构造 CONFIRMED 的 BUY 流水，amount = 数量 × 价格，fxRate 取表单值', () => {
    const tx = buildInitialBuy(form, '600519.SH');
    expect(tx.id).toMatch(/^tx-/);
    expect(tx.instrumentId).toBe('600519.SH');
    expect(tx.type).toBe('BUY');
    expect(tx.status).toBe('CONFIRMED');
    expect(tx.date).toBe('2026-01-01');
    expect(tx.quantity).toBe(100);
    expect(tx.price).toBe(1700);
    expect(tx.amount).toBe(1700 * 100);
    expect(tx.currency).toBe('CNY');
    expect(tx.fxRate).toBe(1);
    expect(tx.note).toBe('建仓');
    expect(tx.source).toBe('MANUAL');
  });

  it('非 1 的汇率也正确透传', () => {
    const tx = buildInitialBuy({ ...form, buyFxRate: '7.25' }, 'AAPL');
    expect(tx.fxRate).toBe(7.25);
    expect(tx.instrumentId).toBe('AAPL');
  });

  // ---------- QA 补充：构造器边界（原用例只覆盖了 happy path） ----------

  it('汇率留空 → 回落为 1，绝不产生 NaN（NaN 会顺着 costPerShare 污染整条收益链）', () => {
    const tx = buildInitialBuy({ ...form, buyFxRate: '' }, '600519.SH');
    expect(tx.fxRate).toBe(1);
    expect(Number.isNaN(tx.fxRate)).toBe(false);
    expect(Number.isNaN(tx.amount)).toBe(false);
  });

  it('备注为纯空白 → 不挂 note 字段（避免导出的 holdings.json 里塞满空串）', () => {
    const tx = buildInitialBuy({ ...form, buyNote: '   ' }, '600519.SH');
    expect(tx.note).toBeUndefined();
    expect('note' in tx).toBe(false);
  });

  it('备注前后空格被 trim', () => {
    const tx = buildInitialBuy({ ...form, buyNote: '  港股通建仓  ' }, '00700.HK');
    expect(tx.note).toBe('港股通建仓');
  });

  it('小数数量（基金份额）不被取整，amount 仍等于 数量 × 价格', () => {
    const tx = buildInitialBuy({ ...form, buyQuantity: '123.456', buyPrice: '1.2345' }, '110011');
    expect(tx.quantity).toBe(123.456);
    expect(tx.price).toBe(1.2345);
    expect(tx.amount).toBeCloseTo(123.456 * 1.2345, 10);
  });

  it('每次调用生成互不相同的流水 id（连续录入两笔不会互相覆盖）', () => {
    const a = buildInitialBuy(form, '600519.SH');
    const b = buildInitialBuy(form, '600519.SH');
    expect(a.id).not.toBe(b.id);
  });
});

import { describe, expect, it } from 'vitest';
import { DataState, Instrument } from '@/types';
import { buildPersonalState } from '@/data';
import { reducer } from '../DataContext';
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
});

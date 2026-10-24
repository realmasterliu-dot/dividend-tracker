import { describe, expect, it } from 'vitest';
import type { TransactionType } from '@/types';
import {
  NEW_TRANSACTION_DRAFT_ID,
  TransactionDraftInput,
  buildTransactionDraft,
} from '../transactionDraft';

const base: TransactionDraftInput = {
  type: 'BUY',
  instrumentId: '000001.SZ',
  date: '2026-08-12',
  currency: 'CNY',
  fxRate: 1,
};

type SuccessCase = {
  type: TransactionType;
  fields: Partial<TransactionDraftInput>;
  expected: {
    quantity: number;
    price: number;
    amount: number;
    ratio?: number;
  };
};

const successCases: SuccessCase[] = [
  { type: 'BUY', fields: { quantity: 10, price: 12.5 }, expected: { quantity: 10, price: 12.5, amount: 125 } },
  { type: 'SELL', fields: { quantity: 4, price: 15, availableQuantity: 4 }, expected: { quantity: -4, price: 15, amount: 60 } },
  { type: 'DIVIDEND_CASH', fields: { amount: 88.8 }, expected: { quantity: 0, price: 0, amount: 88.8 } },
  { type: 'DIVIDEND_REINVEST', fields: { quantity: 1.5, price: 8 }, expected: { quantity: 1.5, price: 8, amount: 12 } },
  { type: 'SPLIT', fields: { ratio: 2 }, expected: { quantity: 0, price: 0, amount: 0, ratio: 2 } },
  { type: 'BONUS', fields: { ratio: 1.2 }, expected: { quantity: 0, price: 0, amount: 0, ratio: 1.2 } },
  { type: 'TRANSFER', fields: { ratio: 1.3 }, expected: { quantity: 0, price: 0, amount: 0, ratio: 1.3 } },
  { type: 'FUND_SPLIT', fields: { ratio: 0.5 }, expected: { quantity: 0, price: 0, amount: 0, ratio: 0.5 } },
  { type: 'FEE', fields: { amount: 6 }, expected: { quantity: 0, price: 0, amount: 6 } },
  { type: 'INCOME', fields: { amount: 100 }, expected: { quantity: 0, price: 0, amount: 100 } },
  { type: 'TAX_WITHHELD', fields: { amount: 12 }, expected: { quantity: 0, price: 0, amount: 12 } },
];

describe('buildTransactionDraft 成功矩阵', () => {
  it.each(successCases)('$type 构造并规范化交易字段', ({ type, fields, expected }) => {
    const result = buildTransactionDraft({ ...base, type, ...fields });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.transaction).toMatchObject({
      id: NEW_TRANSACTION_DRAFT_ID,
      instrumentId: base.instrumentId,
      type,
      status: 'CONFIRMED',
      date: base.date,
      quantity: expected.quantity,
      price: expected.price,
      amount: expected.amount,
      currency: 'CNY',
      fxRate: 1,
      source: 'MANUAL',
    });
    expect(result.transaction.meta?.ratio).toBe(expected.ratio);
  });

  it('忽略与当前类型无关的残留数值', () => {
    const result = buildTransactionDraft({
      ...base,
      type: 'DIVIDEND_CASH',
      amount: 50,
      quantity: 999,
      price: 999,
      ratio: 999,
    });

    expect(result).toMatchObject({
      ok: true,
      transaction: { quantity: 0, price: 0, amount: 50 },
    });
    if (result.ok) expect(result.transaction.meta).toBeUndefined();
  });

  it('保留编辑时传入的 transactionId，并接受零手续费', () => {
    const result = buildTransactionDraft({
      ...base,
      quantity: 2,
      price: 3,
      fee: 0,
      transactionId: ' tx-existing ',
      note: '  调仓  ',
    });

    expect(result).toEqual({
      ok: true,
      transaction: {
        id: 'tx-existing',
        instrumentId: '000001.SZ',
        type: 'BUY',
        status: 'CONFIRMED',
        date: '2026-08-12',
        quantity: 2,
        price: 3,
        amount: 6,
        fee: 0,
        currency: 'CNY',
        fxRate: 1,
        note: '调仓',
        source: 'MANUAL',
      },
    });
  });
});

describe('buildTransactionDraft 基础字段校验', () => {
  it.each([
    ['空标的', { instrumentId: '   ' }, '标的不能为空'],
    ['日期格式错误', { date: '2026/08/12' }, '日期必须是有效的 YYYY-MM-DD'],
    ['不存在的日期', { date: '2026-02-29' }, '日期必须是有效的 YYYY-MM-DD'],
    ['币种错误', { currency: 'EUR' }, '币种无效'],
    ['零汇率', { fxRate: 0 }, '汇率必须是正数'],
    ['无限汇率', { fxRate: Number.POSITIVE_INFINITY }, '汇率必须是正数'],
    ['空编辑 ID', { transactionId: ' ' }, '交易 ID 不能为空'],
  ] as const)('%s 返回错误而非交易', (_label, fields, message) => {
    const result = buildTransactionDraft({
      ...base,
      quantity: 1,
      price: 1,
      ...fields,
    } as TransactionDraftInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain(message);
  });

  it('无效运行时类型返回错误且不抛异常', () => {
    const invalid = { ...base, type: 'UNKNOWN' } as unknown as TransactionDraftInput;
    expect(() => buildTransactionDraft(invalid)).not.toThrow();
    const result = buildTransactionDraft(invalid);
    expect(result).toEqual({ ok: false, errors: ['交易类型无效'] });
  });

  it('聚合多个校验错误', () => {
    const result = buildTransactionDraft({
      ...base,
      instrumentId: '',
      date: '2026-13-01',
      fxRate: -1,
      quantity: 0,
      price: Number.NaN,
      fee: -0.01,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        '标的不能为空',
        '日期必须是有效的 YYYY-MM-DD',
        '汇率必须是正数',
        '手续费必须是非负数',
        '数量必须是正数',
        '价格必须是正数',
      ],
    });
  });
});

describe('buildTransactionDraft 数值边界', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    '数量型交易拒绝非正或非有限数量 %s',
    (quantity) => {
      const result = buildTransactionDraft({ ...base, quantity, price: 10 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContain('数量必须是正数');
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    '数量型交易拒绝非正或非有限价格 %s',
    (price) => {
      const result = buildTransactionDraft({ ...base, quantity: 1, price });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContain('价格必须是正数');
    },
  );

  it.each<TransactionType>(['DIVIDEND_CASH', 'FEE', 'INCOME', 'TAX_WITHHELD'])(
    '%s 拒绝零金额',
    (type) => {
      const result = buildTransactionDraft({ ...base, type, amount: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContain('金额必须是正数');
    },
  );

  it.each<TransactionType>(['SPLIT', 'BONUS', 'TRANSFER', 'FUND_SPLIT'])(
    '%s 拒绝零比例',
    (type) => {
      const result = buildTransactionDraft({ ...base, type, ratio: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContain('比例必须是正数');
    },
  );

  it('可用数量相等时允许卖出，并存为负数量', () => {
    const result = buildTransactionDraft({
      ...base,
      type: 'SELL',
      quantity: 10,
      price: 3,
      availableQuantity: 10,
    });

    expect(result).toMatchObject({ ok: true, transaction: { quantity: -10 } });
  });

  it('阻止超卖', () => {
    const result = buildTransactionDraft({
      ...base,
      type: 'SELL',
      quantity: 10.0001,
      price: 3,
      availableQuantity: 10,
    });

    expect(result).toEqual({ ok: false, errors: ['卖出数量不能超过可用数量'] });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('拒绝无效可用数量 %s', (availableQuantity) => {
    const result = buildTransactionDraft({
      ...base,
      type: 'SELL',
      quantity: 1,
      price: 1,
      availableQuantity,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('可用数量必须是非负数');
  });

  it.each([-0.01, Number.NaN, Number.POSITIVE_INFINITY])('拒绝无效手续费 %s', (fee) => {
    const result = buildTransactionDraft({ ...base, quantity: 1, price: 1, fee });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('手续费必须是非负数');
  });

  it('拒绝乘法溢出的交易金额', () => {
    const result = buildTransactionDraft({
      ...base,
      quantity: Number.MAX_VALUE,
      price: 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('交易金额必须是有限值');
  });
});

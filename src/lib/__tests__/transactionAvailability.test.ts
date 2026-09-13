import { describe, expect, it } from 'vitest';
import type { Transaction } from '@/types';
import { availableQuantityBeforeTransaction } from '../transactionAvailability';

function transaction(overrides: Partial<Transaction> & { id: string }): Transaction {
  return {
    instrumentId: 'AAPL',
    type: 'BUY',
    status: 'CONFIRMED',
    date: '2026-01-01',
    quantity: 10,
    price: 1,
    amount: 10,
    currency: 'USD',
    fxRate: 7,
    source: 'MANUAL',
    ...overrides,
  } as Transaction;
}

function available(
  transactions: Transaction[],
  overrides: Partial<{ instrumentId: string; date: string; transactionId: string }> = {},
) {
  return availableQuantityBeforeTransaction({
    transactions,
    instrumentId: overrides.instrumentId ?? 'AAPL',
    date: overrides.date ?? '2026-03-01',
    transactionId: overrides.transactionId ?? 'tx-candidate',
  });
}

describe('availableQuantityBeforeTransaction', () => {
  it('只使用交易日之前的份额，绝不借用未来买入', () => {
    expect(
      available([
        transaction({ id: 'buy-past', date: '2026-01-01', quantity: 10 }),
        transaction({ id: 'buy-future', date: '2026-04-01', quantity: 100 }),
      ]),
    ).toBe(10);
  });

  it('编辑原 BUY 时排除自身，不能把正在编辑的买入算作可卖', () => {
    expect(
      available(
        [
          transaction({ id: 'buy-old', date: '2026-01-01', quantity: 4 }),
          transaction({ id: 'buy-editing', date: '2026-02-01', quantity: 20 }),
        ],
        { date: '2026-02-01', transactionId: 'buy-editing' },
      ),
    ).toBe(4);
  });

  it('编辑原 SELL 时排除原卖出，但保留此前已经消耗的份额', () => {
    expect(
      available(
        [
          transaction({ id: 'buy', date: '2026-01-01', quantity: 20 }),
          transaction({ id: 'sell-earlier', type: 'SELL', date: '2026-02-01', quantity: -3 }),
          transaction({ id: 'sell-editing', type: 'SELL', date: '2026-03-01', quantity: -7 }),
        ],
        { transactionId: 'sell-editing' },
      ),
    ).toBe(17);
  });

  it('同日按 PositionEngine 的 ID 顺序：候选前的买入可用，候选后的不可用', () => {
    expect(
      available(
        [
          transaction({ id: 'a-buy-before', date: '2026-03-01', quantity: 6 }),
          transaction({ id: 'z-buy-after', date: '2026-03-01', quantity: 60 }),
        ],
        { transactionId: 'm-sell-candidate' },
      ),
    ).toBe(6);
  });

  it('忽略 PENDING/VOIDED 和其他标的，并应用此前的公司行动', () => {
    expect(
      available([
        transaction({ id: 'buy', quantity: 10 }),
        transaction({ id: 'bonus', type: 'BONUS', date: '2026-02-01', quantity: 0, meta: { ratio: 1.5 } }),
        transaction({ id: 'pending', status: 'PENDING', quantity: 100 }),
        transaction({ id: 'voided', status: 'VOIDED', quantity: 100 }),
        transaction({ id: 'other', instrumentId: 'MSFT', quantity: 100 }),
      ]),
    ).toBe(15);
  });

  it('与 FIFO 一样，历史异常超卖不会制造负份额', () => {
    expect(
      available([
        transaction({ id: 'buy-1', quantity: 2 }),
        transaction({ id: 'sell-too-much', type: 'SELL', date: '2026-01-02', quantity: -5 }),
        transaction({ id: 'buy-2', date: '2026-01-03', quantity: 3 }),
      ]),
    ).toBe(3);
  });
});

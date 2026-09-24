import { describe, expect, it } from 'vitest';
import type { DividendEvent, Transaction } from '@/types';
import { accountingDividendEvents, linkCashDividend } from '../transactionDividend';

function cashTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-dividend',
    instrumentId: 'AAPL',
    type: 'DIVIDEND_CASH',
    status: 'CONFIRMED',
    date: '2026-08-13',
    quantity: 0,
    price: 0,
    amount: 10,
    currency: 'USD',
    fxRate: 7,
    source: 'MANUAL',
    ...overrides,
  };
}

function dividend(overrides: Partial<DividendEvent> = {}): DividendEvent {
  return {
    id: 'market-dividend',
    instrumentId: 'AAPL',
    status: 'PAID',
    payDate: '2026-08-13',
    payDateEstimated: false,
    perShareAmount: 0.25,
    currency: 'USD',
    quantityAtRecord: 40,
    grossAmount: 70,
    taxRateApplied: 0.3,
    taxWithheld: 21,
    contingentTax: 0,
    netAmount: 49,
    taxBracket: 'NONE',
    dividendForm: 'CASH',
    manual: false,
    sourceKey: 'feed:aapl:2026q2',
    ...overrides,
  };
}

describe('linkCashDividend', () => {
  it('没有行情事件时建立稳定的手工事件，并把标的金额换算为本位币到账', () => {
    const linked = linkCashDividend(cashTransaction(), [], 40);

    expect(linked.transaction.meta?.dividendEventId).toBe('dividend-tx-dividend');
    expect(linked.event).toMatchObject({
      id: 'dividend-tx-dividend',
      instrumentId: 'AAPL',
      status: 'RECONCILED',
      payDate: '2026-08-13',
      perShareAmount: 0.25,
      quantityAtRecord: 40,
      actualReceived: 70,
      netAmount: 70,
      manual: true,
      sourceKey: 'manual-transaction:tx-dividend',
    });
  });

  it('同标的同到账日唯一命中行情事件时复用其 ID，避免重复统计', () => {
    const linked = linkCashDividend(cashTransaction(), [dividend()], 40);

    expect(linked.transaction.meta?.dividendEventId).toBe('market-dividend');
    expect(linked.event.id).toBe('market-dividend');
    expect(linked.event.sourceKey).toBe('feed:aapl:2026q2');
    expect(linked.event.status).toBe('RECONCILED');
    expect(linked.event.actualReceived).toBe(70);
    expect(linked.event.perShareAmount).toBe(0.25);
    expect(linked.event.grossAmount).toBe(70);
    expect(linked.event.taxWithheld).toBe(21);
  });

  it('编辑时优先按 meta 稳定关联原事件，并保留其他 meta', () => {
    const transaction = cashTransaction({
      date: '2026-08-14',
      amount: 12,
      meta: { dividendEventId: 'market-dividend', planId: 'legacy-plan' },
    });
    const linked = linkCashDividend(transaction, [dividend()], 40);

    expect(linked.event.id).toBe('market-dividend');
    expect(linked.event.payDate).toBe('2026-08-14');
    expect(linked.event.actualReceived).toBe(84);
    expect(linked.transaction.meta).toEqual({
      dividendEventId: 'market-dividend',
      planId: 'legacy-plan',
    });
  });

  it('同日存在多个候选时不猜测，创建独立且可重复 upsert 的事件', () => {
    const events = [dividend(), dividend({ id: 'special-dividend', sourceKey: 'feed:special' })];
    const first = linkCashDividend(cashTransaction(), events, 40);
    const second = linkCashDividend(first.transaction, [...events, first.event], 40);

    expect(first.event.id).toBe('dividend-tx-dividend');
    expect(second.event.id).toBe(first.event.id);
  });

  it('第二笔同日手工到账保持独立，不覆盖第一笔', () => {
    const first = linkCashDividend(cashTransaction({ id: 'first' }), [], 40);
    const second = linkCashDividend(
      cashTransaction({ id: 'second', amount: 3 }),
      [first.event],
      40,
    );

    expect(first.event.id).toBe('dividend-first');
    expect(second.event.id).toBe('dividend-second');
    expect(second.event.actualReceived).toBe(21);
  });

  it('编辑现金分红改标的时不把原标的管道事件改到新公司', () => {
    const edited = cashTransaction({
      instrumentId: 'MSFT',
      meta: { dividendEventId: 'market-dividend' },
    });
    const linked = linkCashDividend(edited, [dividend()], 20);

    expect(linked.event.id).toBe('dividend-tx-dividend');
    expect(linked.event.instrumentId).toBe('MSFT');
    expect(linked.event.manual).toBe(true);
    expect(linked.transaction.meta?.dividendEventId).toBe('dividend-tx-dividend');
  });

  it('多条同日管道估算被手工实际到账替代，不重复进入金额统计', () => {
    const pipeline = [
      dividend(),
      dividend({ id: 'special-dividend', sourceKey: 'feed:special', isSpecial: true }),
    ];
    const actual = linkCashDividend(cashTransaction(), pipeline, 40).event;
    const accounting = accountingDividendEvents([...pipeline, actual]);

    expect(accounting).toEqual([actual]);
    expect(accounting.reduce((sum, event) => sum + event.netAmount, 0)).toBe(70);
  });
});

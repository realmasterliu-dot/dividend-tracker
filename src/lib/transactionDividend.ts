import type { DividendEvent, Transaction } from '@/types';

const LINK_META_KEY = 'dividendEventId';
const MANUAL_SOURCE_PREFIX = 'manual-transaction:';

function linkedEventId(transaction: Transaction): string | undefined {
  const value = transaction.meta?.[LINK_META_KEY];
  return typeof value === 'string' && value ? value : undefined;
}

function eventDate(event: DividendEvent): string | undefined {
  return event.payDate ?? event.exDate ?? event.recordDate;
}

function findExistingEvent(
  transaction: Transaction,
  dividends: DividendEvent[],
): DividendEvent | undefined {
  const id = linkedEventId(transaction);
  if (id) {
    const linked = dividends.find((event) => event.id === id);
    // A pipeline event belongs to its original instrument. If an edited cash
    // receipt moves to another symbol, detach it instead of rewriting that
    // corporate action under the wrong company. Manual events are transaction-
    // owned and may safely move with the edited transaction.
    if (linked && (linked.manual || linked.instrumentId === transaction.instrumentId)) return linked;
  }

  const sourceKey = `${MANUAL_SOURCE_PREFIX}${transaction.id}`;
  const sourced = dividends.find((event) => event.sourceKey === sourceKey);
  if (sourced) return sourced;

  // Only an un-reconciled pipeline event is eligible for automatic linking.
  // A manual event belongs to its own transaction; reusing it would make a
  // second same-day receipt overwrite the first one.
  const sameDay = dividends.filter(
    (event) =>
      !event.manual &&
      event.actualReceived === undefined &&
      event.instrumentId === transaction.instrumentId &&
      eventDate(event) === transaction.date,
  );
  return sameDay.length === 1 ? sameDay[0] : undefined;
}

/**
 * Returns events that should contribute to money totals. When several pipeline
 * rows share a pay date and the user records one authoritative manual receipt,
 * the receipt replaces those estimates for accounting purposes. Raw pipeline
 * rows remain in state, so their corporate-action dates are not destroyed.
 */
export function accountingDividendEvents(dividends: DividendEvent[]): DividendEvent[] {
  const authoritativeDates = new Set(
    dividends
      .filter(
        (event) =>
          event.manual &&
          event.status === 'RECONCILED' &&
          typeof event.actualReceived === 'number' &&
          eventDate(event),
      )
      .map((event) => `${event.instrumentId}\u0000${eventDate(event)}`),
  );

  return dividends.filter(
    (event) =>
      event.manual ||
      !authoritativeDates.has(`${event.instrumentId}\u0000${eventDate(event)}`),
  );
}

export interface LinkedCashDividend {
  transaction: Transaction;
  event: DividendEvent;
}

/**
 * 将现金分红流水关联到 Dashboard 使用的 DividendEvent。
 *
 * Transaction.amount 是标的币种，DividendEvent.actualReceived/netAmount 是本位币，
 * 因而这里使用 amount × fxRate。关联 ID 写入 meta，之后编辑只会 upsert 同一事件。
 */
export function linkCashDividend(
  transaction: Transaction,
  dividends: DividendEvent[],
  quantityAtRecord: number,
): LinkedCashDividend {
  const existing = findExistingEvent(transaction, dividends);
  const actualReceived = transaction.amount * transaction.fxRate;
  const safeQuantity = Number.isFinite(quantityAtRecord) && quantityAtRecord > 0
    ? quantityAtRecord
    : 0;
  const perShareAmount = safeQuantity > 0 ? transaction.amount / safeQuantity : 0;
  const eventId = existing?.id ?? `dividend-${transaction.id}`;

  const event: DividendEvent = existing
    ? {
        ...existing,
        instrumentId: transaction.instrumentId,
        currency: transaction.currency,
        status: 'RECONCILED',
        payDate: transaction.date,
        payDateEstimated: false,
        // Pipeline per-share, record quantity, gross and tax estimates describe
        // the declared event. The transaction contributes only the observed net.
        actualReceived,
        netAmount: actualReceived,
      }
    : {
        id: eventId,
        instrumentId: transaction.instrumentId,
        status: 'RECONCILED',
        payDate: transaction.date,
        payDateEstimated: false,
        perShareAmount,
        currency: transaction.currency,
        quantityAtRecord: safeQuantity,
        grossAmount: actualReceived,
        taxRateApplied: 0,
        taxWithheld: 0,
        contingentTax: 0,
        netAmount: actualReceived,
        actualReceived,
        taxBracket: 'NONE',
        dividendForm: 'CASH',
        manual: true,
        sourceKey: `${MANUAL_SOURCE_PREFIX}${transaction.id}`,
      };

  return {
    transaction: {
      ...transaction,
      meta: {
        ...transaction.meta,
        [LINK_META_KEY]: eventId,
      },
    },
    event,
  };
}

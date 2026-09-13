import type { Transaction } from '@/types';

interface AvailabilityInput {
  transactions: Transaction[];
  instrumentId: string;
  date: string;
  /** 新流水的预生成 ID，或正在编辑的原流水 ID。 */
  transactionId: string;
}

function happensBeforeCandidate(transaction: Transaction, date: string, transactionId: string) {
  return (
    transaction.date < date ||
    (transaction.date === date && transaction.id.localeCompare(transactionId) < 0)
  );
}

function actionRatio(transaction: Transaction): number {
  const ratio = transaction.meta?.ratio;
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * 返回一笔流水发生前的可用份额。
 *
 * 口径与 PositionEngine 一致：只读取已确认流水，并按「日期、ID」排序。
 * 正在编辑的流水因为 ID 相同会被排除，因此编辑 BUY 时不会借用自身份额，
 * 编辑 SELL 时也不会重复扣减原卖出；候选流水之后（包括同日但 ID 更大）的买入不会被借用。
 */
export function availableQuantityBeforeTransaction({
  transactions,
  instrumentId,
  date,
  transactionId,
}: AvailabilityInput): number {
  const preceding = transactions
    .filter(
      (transaction) =>
        transaction.id !== transactionId &&
        transaction.instrumentId === instrumentId &&
        transaction.status === 'CONFIRMED' &&
        happensBeforeCandidate(transaction, date, transactionId),
    )
    .sort((left, right) =>
      left.date === right.date
        ? left.id.localeCompare(right.id)
        : left.date.localeCompare(right.date),
    );

  let quantity = 0;
  for (const transaction of preceding) {
    switch (transaction.type) {
      case 'BUY':
      case 'DIVIDEND_REINVEST':
        quantity += Math.max(0, transaction.quantity);
        break;
      case 'SELL':
        // consumeFifo 不会把批次扣成负数，这里保持相同语义。
        quantity = Math.max(0, quantity - Math.abs(transaction.quantity));
        break;
      case 'SPLIT':
      case 'BONUS':
      case 'TRANSFER':
      case 'FUND_SPLIT':
        quantity *= actionRatio(transaction);
        break;
      default:
        break;
    }
  }

  return Math.max(0, quantity);
}

import type { Currency, Transaction, TransactionType } from '@/types';

const TRANSACTION_TYPES: readonly TransactionType[] = [
  'BUY',
  'SELL',
  'DIVIDEND_CASH',
  'DIVIDEND_REINVEST',
  'SPLIT',
  'BONUS',
  'TRANSFER',
  'FUND_SPLIT',
  'FEE',
  'INCOME',
  'TAX_WITHHELD',
];

const CURRENCIES: readonly Currency[] = ['CNY', 'USD', 'HKD'];
const QUANTITY_TYPES: readonly TransactionType[] = ['BUY', 'SELL', 'DIVIDEND_REINVEST'];
const AMOUNT_TYPES: readonly TransactionType[] = [
  'DIVIDEND_CASH',
  'FEE',
  'INCOME',
  'TAX_WITHHELD',
];
const RATIO_TYPES: readonly TransactionType[] = ['SPLIT', 'BONUS', 'TRANSFER', 'FUND_SPLIT'];

/**
 * A stable placeholder keeps draft construction deterministic. Callers should
 * supply a generated transactionId when committing a new transaction, and the
 * existing id when editing one.
 */
export const NEW_TRANSACTION_DRAFT_ID = 'transaction-draft';

export interface TransactionDraftInput {
  type: TransactionType;
  instrumentId: string;
  date: string;
  currency: Currency;
  fxRate: number;
  quantity?: number;
  price?: number;
  amount?: number;
  ratio?: number;
  fee?: number;
  availableQuantity?: number;
  transactionId?: string;
  note?: string;
}

export type TransactionDraftResult =
  | { ok: true; transaction: Transaction }
  | { ok: false; errors: string[] };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isTransactionType(value: unknown): value is TransactionType {
  return TRANSACTION_TYPES.includes(value as TransactionType);
}

function isCurrency(value: unknown): value is Currency {
  return CURRENCIES.includes(value as Currency);
}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Validate and normalize user-entered transaction fields without side effects.
 * Invalid input is represented by the result union; this function never uses
 * exceptions for validation failures.
 */
export function buildTransactionDraft(input: TransactionDraftInput): TransactionDraftResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['交易草稿输入必须是对象'] };
  }

  const errors: string[] = [];
  const instrumentId = typeof input.instrumentId === 'string' ? input.instrumentId.trim() : '';

  if (!isTransactionType(input.type)) errors.push('交易类型无效');
  if (!instrumentId) errors.push('标的不能为空');
  if (!isIsoCalendarDate(input.date)) errors.push('日期必须是有效的 YYYY-MM-DD');
  if (!isCurrency(input.currency)) errors.push('币种无效');
  if (!isPositive(input.fxRate)) errors.push('汇率必须是正数');

  if (input.transactionId !== undefined) {
    if (typeof input.transactionId !== 'string' || !input.transactionId.trim()) {
      errors.push('交易 ID 不能为空');
    }
  }

  if (input.fee !== undefined && (!isFiniteNumber(input.fee) || input.fee < 0)) {
    errors.push('手续费必须是非负数');
  }

  if (
    input.availableQuantity !== undefined &&
    (!isFiniteNumber(input.availableQuantity) || input.availableQuantity < 0)
  ) {
    errors.push('可用数量必须是非负数');
  }

  let quantity = 0;
  let price = 0;
  let amount = 0;
  let ratio: number | undefined;

  if (isTransactionType(input.type) && QUANTITY_TYPES.includes(input.type)) {
    if (!isPositive(input.quantity)) errors.push('数量必须是正数');
    if (!isPositive(input.price)) errors.push('价格必须是正数');

    if (isPositive(input.quantity) && isPositive(input.price)) {
      quantity = input.type === 'SELL' ? -input.quantity : input.quantity;
      price = input.price;
      amount = input.quantity * input.price;
      if (!Number.isFinite(amount)) errors.push('交易金额必须是有限值');
    }

    if (
      input.type === 'SELL' &&
      isPositive(input.quantity) &&
      isFiniteNumber(input.availableQuantity) &&
      input.availableQuantity >= 0 &&
      input.quantity > input.availableQuantity
    ) {
      errors.push('卖出数量不能超过可用数量');
    }
  } else if (isTransactionType(input.type) && AMOUNT_TYPES.includes(input.type)) {
    if (!isPositive(input.amount)) errors.push('金额必须是正数');
    if (isPositive(input.amount)) amount = input.amount;
  } else if (isTransactionType(input.type) && RATIO_TYPES.includes(input.type)) {
    if (!isPositive(input.ratio)) errors.push('比例必须是正数');
    if (isPositive(input.ratio)) ratio = input.ratio;
  }

  if (errors.length > 0) return { ok: false, errors };

  // The guards above make these casts safe while keeping the public input type ergonomic.
  const transaction: Transaction = {
    id: input.transactionId?.trim() ?? NEW_TRANSACTION_DRAFT_ID,
    instrumentId,
    type: input.type,
    status: 'CONFIRMED',
    date: input.date,
    quantity,
    price,
    amount,
    ...(input.fee !== undefined ? { fee: input.fee } : {}),
    currency: input.currency,
    fxRate: input.fxRate,
    ...(typeof input.note === 'string' && input.note.trim() ? { note: input.note.trim() } : {}),
    source: 'MANUAL',
    ...(ratio !== undefined ? { meta: { ratio } } : {}),
  };

  return { ok: true, transaction };
}

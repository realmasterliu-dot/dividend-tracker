import { Currency, FxSnapshot } from '@/types';
import { isSameOrBefore } from '../clock';

/**
 * 币种换算（architecture.md §8.4：金额统一换算本位币进 UI）
 * fx.rates key 格式：`${from}${to}`，如 'USDCNY' = 1 USD 兑换 7.25 CNY。
 */

export function rateKey(from: Currency, to: Currency): string {
  if (from === to) return '';
  return `${from}${to}`;
}

export function latestFx(fx: FxSnapshot[], from: Currency, to: Currency): number {
  if (from === to) return 1;
  const key = rateKey(from, to);
  const snap = fx[fx.length - 1];
  const rate = snap?.rates?.[key];
  if (typeof rate === 'number' && rate > 0) return rate;
  // 反向汇率兜底（如只存了 CNYUSD，需要 USDCNY）
  const invKey = rateKey(to, from);
  const inv = snap?.rates?.[invKey];
  if (typeof inv === 'number' && inv > 0) return 1 / inv;
  return 1;
}

/** 指定日期的汇率（forward-fill：取 <= date 的最近快照） */
export function fxOn(fx: FxSnapshot[], from: Currency, to: Currency, date: string): number {
  if (from === to) return 1;
  const key = rateKey(from, to);
  let last: FxSnapshot | undefined;
  for (const snap of fx) {
    if (isSameOrBefore(snap.date, date)) last = snap;
    else break;
  }
  const rate = last?.rates?.[key];
  if (typeof rate === 'number' && rate > 0) return rate;
  const inv = last?.rates?.[rateKey(to, from)];
  if (typeof inv === 'number' && inv > 0) return 1 / inv;
  return latestFx(fx, from, to);
}

export function convertAmount(amount: number, from: Currency, to: Currency, rate: number): number {
  if (from === to) return amount;
  return amount * rate;
}

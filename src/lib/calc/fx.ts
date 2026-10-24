import { Currency, FxSnapshot } from '@/types';
import { compareDates } from '../clock';

/**
 * 币种换算（architecture.md §8.4：金额统一换算本位币进 UI）
 * fx.rates key 格式：`${from}${to}`，如 'USDCNY' = 1 USD 兑换 7.25 CNY。
 */

export function rateKey(from: Currency, to: Currency): string {
  if (from === to) return '';
  return `${from}${to}`;
}

function directOrInverseRate(
  rates: FxSnapshot['rates'] | undefined,
  from: Currency,
  to: Currency,
): number | undefined {
  if (from === to) return 1;
  const direct = rates?.[rateKey(from, to)];
  if (typeof direct === 'number' && direct > 0) return direct;
  const inverse = rates?.[rateKey(to, from)];
  if (typeof inverse === 'number' && inverse > 0) return 1 / inverse;
  return undefined;
}

/**
 * Resolves a rate from one snapshot. If no direct pair exists, derive a cross
 * rate through another supported currency (normally CNY in the bundled data).
 */
function resolvedSnapshotRate(
  snapshot: FxSnapshot | undefined,
  from: Currency,
  to: Currency,
): number | undefined {
  const direct = directOrInverseRate(snapshot?.rates, from, to);
  if (direct !== undefined) return direct;
  const currencies: Currency[] = ['CNY', 'USD', 'HKD'];
  for (const pivot of currencies) {
    if (pivot === from || pivot === to) continue;
    const first = directOrInverseRate(snapshot?.rates, from, pivot);
    const second = directOrInverseRate(snapshot?.rates, pivot, to);
    if (first !== undefined && second !== undefined) return first * second;
  }
  return undefined;
}

export function latestFx(fx: FxSnapshot[], from: Currency, to: Currency): number {
  if (from === to) return 1;
  const snap = fx[fx.length - 1];
  return resolvedSnapshotRate(snap, from, to) ?? 1;
}

/**
 * 二分定位 <= date 的最近汇率快照（forward-fill 的定位步骤）。
 *
 * 前置条件：fx 按日期升序 —— realData.normalizeFx() 与 seedFx 均已保证，
 * 原线性实现同样依赖该前提（遇到首个 > date 的快照即 break）。
 */
export function fxSnapshotOn(fx: FxSnapshot[], date: string): FxSnapshot | undefined {
  let low = 0;
  let high = fx.length - 1;
  let found: FxSnapshot | undefined;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (compareDates(fx[mid].date, date) <= 0) {
      found = fx[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * 从已定位的快照换算汇率，兜底顺序与 fxOn 一致：正向 → 反向取倒数 → 最新汇率。
 *
 * 单独暴露是为了让「按日期升序遍历」的调用方（如组合快照重建）复用同一张快照，
 * 不必为每个标的重新做一次 forward-fill 定位。
 */
export function rateFromSnapshot(
  snapshot: FxSnapshot | undefined,
  fx: FxSnapshot[],
  from: Currency,
  to: Currency,
): number {
  if (from === to) return 1;
  const rate = resolvedSnapshotRate(snapshot, from, to);
  if (rate !== undefined) return rate;
  return latestFx(fx, from, to);
}

/** 指定日期的汇率（forward-fill：取 <= date 的最近快照） */
export function fxOn(fx: FxSnapshot[], from: Currency, to: Currency, date: string): number {
  if (from === to) return 1;
  return rateFromSnapshot(fxSnapshotOn(fx, date), fx, from, to);
}

export function convertAmount(amount: number, from: Currency, to: Currency, rate: number): number {
  if (from === to) return amount;
  return amount * rate;
}

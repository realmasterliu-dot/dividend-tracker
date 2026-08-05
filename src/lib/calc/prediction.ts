import { DividendEvent, DividendPrediction, PredictionFrequency } from '@/types';
import { daysBetween, yearOf } from '../clock';

/**
 * PredictionEngine（architecture.md 类图 + PRD §3.2.6）
 * 输出恒为 {区间, 置信度, 稳定性评分}，拒绝单一数字。
 * 特别股息识别并剔除；已宣告值由 UI 覆盖统计预测。
 */

export function detectFrequency(dividends: DividendEvent[]): PredictionFrequency {
  const dates = dividends
    .map((d) => d.payDate ?? d.exDate ?? d.recordDate)
    .filter((d): d is string => Boolean(d))
    .sort();
  if (dates.length < 2) return 'IRREGULAR';

  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(daysBetween(dates[i - 1], dates[i]));
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)] / 30.44; // 月

  if (median < 2.2) return 'MONTHLY';
  if (median < 5) return 'QUARTERLY';
  if (median < 9) return 'SEMI';
  if (median < 15) return 'YEARLY';
  return 'IRREGULAR';
}

/** 特别股息识别：金额超过中位数 2 倍 或 与前后间隔异常（演示用简单规则） */
export function excludeSpecial(dividends: DividendEvent[]): DividendEvent[] {
  const paid = dividends.filter((d) => d.status === 'PAID' || d.status === 'RECONCILED');
  if (paid.length < 3) return paid;
  const amounts = paid.map((d) => d.netAmount).sort((a, b) => a - b);
  const median = amounts[Math.floor(amounts.length / 2)];
  return paid.filter((d) => d.netAmount <= median * 2);
}

/** 稳定性评分（PRD §3.2.6 五档） */
export function stabilityScore(yearlyTotals: number[], gapsMonths: number[]): 1 | 2 | 3 | 4 | 5 {
  if (yearlyTotals.length <= 1) return 1;
  const sorted = [...yearlyTotals].sort((a, b) => a - b);
  const drops: number[] = [];
  for (let i = 1; i < yearlyTotals.length; i++) {
    if (yearlyTotals[i] < yearlyTotals[i - 1]) {
      drops.push((yearlyTotals[i - 1] - yearlyTotals[i]) / yearlyTotals[i - 1]);
    }
  }
  const maxDrop = drops.length ? Math.max(...drops) : 0;

  const gapsOk = gapsMonths.length === 0 || gapsMonths.every((g) => g > 0.5);
  if (yearlyTotals.length >= 5 && maxDrop === 0 && gapsOk) return 5;
  if (yearlyTotals.length >= 4 && maxDrop < 0.15 && gapsOk) return 4;
  if (yearlyTotals.length >= 3 && maxDrop < 0.4) return 3;
  if (yearlyTotals.length >= 2) return 2;
  return 1;
}

export function predictForInstrument(
  instrumentId: string,
  allDividends: DividendEvent[],
): DividendPrediction {
  const own = allDividends.filter((d) => d.instrumentId === instrumentId);
  const special = own.filter((d) => d.isSpecial);
  const paid = own.filter((d) => (d.status === 'PAID' || d.status === 'RECONCILED') && !d.isSpecial);
  const history = [...paid].sort((a, b) => (a.payDate ?? a.exDate ?? '').localeCompare(b.payDate ?? b.exDate ?? ''));

  // 频率识别用全量派息历史（样本越多越稳），金额统计只用"用户实际到手"的事件。
  // ★接入真实数据管道后历史可回溯至建仓前数十年，那些事件到手金额为 0，
  //   若计入年度汇总会把中位数与预测区间整体拉到 0。
  const frequency = detectFrequency(history);
  const sorted = history.filter((d) => d.netAmount > 0);
  const specialDividendsExcluded = special.map((d) => d.id);

  if (sorted.length === 0) {
    return {
      instrumentId,
      frequency,
      lower: 0,
      upper: 0,
      confidence: 'LOW',
      stabilityScore: 1,
      sampleYears: 0,
      method: 'NONE',
      specialDividendsExcluded,
      note: '无已到账分红记录（建仓前的派息不计入），无法预测',
    };
  }

  // 按自然年汇总
  const yearMap = new Map<number, number>();
  for (const d of sorted) {
    const year = yearOf(d.payDate ?? d.exDate ?? d.recordDate ?? '2026-01-01');
    yearMap.set(year, (yearMap.get(year) ?? 0) + d.netAmount);
  }
  const years = [...yearMap.keys()].sort((a, b) => a - b);
  const yearlyTotals = years.map((y) => yearMap.get(y) ?? 0);
  const sampleYears = years.length;

  const median = (arr: number[]): number => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const med = median(yearlyTotals);
  const min = Math.min(...yearlyTotals);
  const max = Math.max(...yearlyTotals);

  let method: DividendPrediction['method'];
  let lower: number;
  let upper: number;
  let confidence: DividendPrediction['confidence'];

  if (sampleYears >= 3) {
    const first = yearlyTotals[0];
    const last = yearlyTotals[yearlyTotals.length - 1];
    const cagr = first > 0 ? Math.pow(last / first, 1 / (sampleYears - 1)) - 1 : 0;
    const projected = med * (1 + Math.max(-0.3, Math.min(0.3, cagr)));
    lower = Math.min(min * 0.9, projected * 0.9);
    upper = Math.max(max * 1.1, projected * 1.1);
    method = 'CAGR';
    const spread = (max - min) / (med || 1);
    confidence = spread < 0.2 ? 'HIGH' : spread < 0.45 ? 'MED' : 'LOW';
  } else if (sampleYears === 2) {
    lower = min * 0.9;
    upper = max * 1.1;
    method = 'MEDIAN';
    confidence = 'MED';
  } else {
    lower = med * 0.8;
    upper = med * 1.2;
    method = 'MEDIAN';
    confidence = 'LOW';
  }

  const gapsMonths: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].payDate ?? sorted[i - 1].exDate ?? sorted[i - 1].recordDate;
    const b = sorted[i].payDate ?? sorted[i].exDate ?? sorted[i].recordDate;
    if (a && b) gapsMonths.push(daysBetween(a, b) / 30.44);
  }

  const score = stabilityScore(yearlyTotals, gapsMonths);
  const note =
    sampleYears === 1
      ? `仅 ${sampleYears} 年样本，参考价值有限`
      : `近 ${sampleYears} 年派息，${method === 'CAGR' ? 'CAGR 外推' : '中位数外推'}，稳定性 ${score}/5`;

  return {
    instrumentId,
    frequency,
    lower,
    upper,
    confidence,
    stabilityScore: score,
    sampleYears,
    method,
    specialDividendsExcluded,
    note,
  };
}

export function predictAll(
  dividends: DividendEvent[],
  instrumentIds: string[],
): Record<string, DividendPrediction> {
  const result: Record<string, DividendPrediction> = {};
  for (const id of instrumentIds) {
    result[id] = predictForInstrument(id, dividends);
  }
  return result;
}

import { describe, expect, it } from 'vitest';
import { DividendEvent, DividendPrediction } from '@/types';
import { detectFrequency, excludeSpecial, predictForInstrument, stabilityScore } from '../prediction';
import { addDays, SEED_TODAY } from '../../clock';

function mkDiv(over: Partial<DividendEvent> & { id: string; payDate?: string }): DividendEvent {
  return {
    instrumentId: 'TEST',
    status: 'PAID',
    payDate: '2026-01-01',
    payDateEstimated: false,
    perShareAmount: 1,
    currency: 'CNY',
    quantityAtRecord: 100,
    grossAmount: 100,
    taxRateApplied: 0,
    taxWithheld: 0,
    contingentTax: 0,
    netAmount: 100,
    taxBracket: 'NONE',
    dividendForm: 'CASH',
    manual: false,
    sourceKey: 'k',
    ...over,
  } as DividendEvent;
}

function annualDivs(netAmounts: number[], years: number[]): DividendEvent[] {
  return years.map((year, i) =>
    mkDiv({
      id: `d-${year}`,
      status: 'PAID',
      payDate: `${year}-06-30`,
      netAmount: netAmounts[i],
      grossAmount: netAmounts[i],
    }),
  );
}

describe('派息频率识别（PRD §5.8）', () => {
  it('年派息（间隔约 12 个月）→ YEARLY', () => {
    const divs = annualDivs([100, 100, 100], [2023, 2024, 2025]);
    expect(detectFrequency(divs)).toBe('YEARLY');
  });

  it('季度派息（间隔约 3 个月）→ QUARTERLY', () => {
    const divs = [
      mkDiv({ id: 'q1', payDate: '2025-03-31' }),
      mkDiv({ id: 'q2', payDate: '2025-06-30' }),
      mkDiv({ id: 'q3', payDate: '2025-09-30' }),
      mkDiv({ id: 'q4', payDate: '2025-12-31' }),
    ];
    expect(detectFrequency(divs)).toBe('QUARTERLY');
  });

  it('月派息（间隔约 1 个月）→ MONTHLY', () => {
    const divs = [0, 1, 2, 3].map((i) => mkDiv({ id: `m${i}`, payDate: addDays('2026-01-01', i * 30) }));
    expect(detectFrequency(divs)).toBe('MONTHLY');
  });

  it('少于 2 条记录 → IRREGULAR', () => {
    expect(detectFrequency([mkDiv({ id: 'only', payDate: '2025-06-30' })])).toBe('IRREGULAR');
  });
});

describe('预测输出形态（PRD §3.2.6 D1：恒为区间+置信度+稳定性，拒绝单一数字）', () => {
  it('输出包含 lower/upper 区间、confidence、stabilityScore，且无单一数字字段', () => {
    const pred = predictForInstrument('TEST', annualDivs([100, 110, 105], [2023, 2024, 2025]));
    expect(typeof pred.lower).toBe('number');
    expect(typeof pred.upper).toBe('number');
    expect(pred.lower).toBeLessThanOrEqual(pred.upper);
    expect(['HIGH', 'MED', 'LOW']).toContain(pred.confidence);
    expect([1, 2, 3, 4, 5]).toContain(pred.stabilityScore);
    expect(pred.method).toMatch(/CAGR|MEDIAN|NONE/);
    // 关键：没有单一数字预测字段（如 point/expected）
    expect('point' in pred).toBe(false);
    expect('expected' in pred).toBe(false);
  });

  it('连续 3 年稳定派息 → 置信度 HIGH，方法 CAGR', () => {
    const pred = predictForInstrument('TEST', annualDivs([100, 100, 100], [2023, 2024, 2025]));
    expect(pred.confidence).toBe('HIGH');
    expect(pred.method).toBe('CAGR');
    expect(pred.sampleYears).toBe(3);
  });

  it('无历史记录 → method NONE，区间 0-0，置信度 LOW', () => {
    const pred = predictForInstrument('TEST', []);
    expect(pred.method).toBe('NONE');
    expect(pred.lower).toBe(0);
    expect(pred.upper).toBe(0);
    expect(pred.confidence).toBe('LOW');
    expect(pred.stabilityScore).toBe(1);
    expect(pred.note).toContain('无法预测');
  });

  it('特别股息被剔除：specialDividendsExcluded 列出 id，且不影响年度汇总', () => {
    const special = mkDiv({ id: 'special-1', status: 'PAID', payDate: '2024-12-01', netAmount: 5000, isSpecial: true });
    const pred = predictForInstrument(
      'TEST',
      annualDivs([100, 100, 100], [2023, 2024, 2025]).concat(special),
    );
    expect(pred.specialDividendsExcluded).toContain('special-1');
    // 剔除后样本年份仍为 3（2023/2024/2025），特别股息 5000 未计入
    expect(pred.sampleYears).toBe(3);
  });

  it('excludeSpecial：金额超过中位数 2 倍被剔除', () => {
    const divs = [
      mkDiv({ id: 'a', status: 'PAID', netAmount: 100 }),
      mkDiv({ id: 'b', status: 'PAID', netAmount: 110 }),
      mkDiv({ id: 'c', status: 'PAID', netAmount: 120 }),
      mkDiv({ id: 'spike', status: 'PAID', netAmount: 1000 }),
    ];
    const kept = excludeSpecial(divs);
    expect(kept.some((d) => d.id === 'spike')).toBe(false);
    expect(kept).toHaveLength(3);
  });
});

describe('稳定性评分（PRD §3.2.6 五档）', () => {
  it('连续 5 年无下降 → 5 分', () => {
    expect(stabilityScore([100, 100, 100, 100, 100], [])).toBe(5);
  });

  it('4 年且最大下降 <15% → 4 分', () => {
    expect(stabilityScore([100, 100, 95, 100], [])).toBe(4);
  });

  it('3 年波动较大（最大降幅 <40%）→ 3 分', () => {
    expect(stabilityScore([100, 65, 90], [])).toBe(3);
  });

  it('3 年出现 ≥40% 大幅下降 → 回落到 2 分（边界）', () => {
    expect(stabilityScore([100, 60, 90], [])).toBe(2);
  });

  it('仅 1 年 → 1 分', () => {
    expect(stabilityScore([100], [])).toBe(1);
  });
});

describe('预测中"已宣告覆盖"的数据准备（PRD §3.2.6 ④）', () => {
  it('DECLARED 状态分红进入已宣告集合，与统计预测并列保留', () => {
    const declared = mkDiv({ id: 'declared-2026', status: 'DECLARED', payDate: '2026-09-30', netAmount: 120 });
    const pred = predictForInstrument(
      'TEST',
      annualDivs([100, 100, 100], [2023, 2024, 2025]).concat(declared),
    );
    // 已宣告值不进入统计样本（仅 PAID/RECONCILED），但样本年份仍为 3
    expect(pred.sampleYears).toBe(3);
    expect(pred.note).toContain('3');
  });
});

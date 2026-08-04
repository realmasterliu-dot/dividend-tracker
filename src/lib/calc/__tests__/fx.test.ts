import { describe, expect, it } from 'vitest';
import { FxSnapshot } from '@/types';
import { convertAmount, fxOn, latestFx, rateKey } from '../fx';

const FX: FxSnapshot[] = [
  { date: '2026-07-01', rates: { USDCNY: 7.1 } },
  { date: '2026-08-01', rates: { USDCNY: 7.2, HKDCNY: 0.92 } },
];

describe('币种换算（PRD §11.1 A5：CNY/USD 切换正确）', () => {
  it('rateKey：同币种为空，异币种为 from+to', () => {
    expect(rateKey('CNY', 'CNY')).toBe('');
    expect(rateKey('USD', 'CNY')).toBe('USDCNY');
  });

  it('latestFx：正向汇率', () => {
    expect(latestFx(FX, 'USD', 'CNY')).toBeCloseTo(7.2, 6);
  });

  it('latestFx：反向汇率自动取倒数', () => {
    expect(latestFx(FX, 'CNY', 'USD')).toBeCloseTo(1 / 7.2, 6);
  });

  it('latestFx：同币种恒为 1', () => {
    expect(latestFx(FX, 'CNY', 'CNY')).toBe(1);
    expect(latestFx([], 'USD', 'CNY')).toBe(1);
  });

  it('convertAmount：USD→CNY 按汇率换算，同币种原样返回', () => {
    expect(convertAmount(100, 'USD', 'CNY', 7.2)).toBeCloseTo(720, 6);
    expect(convertAmount(100, 'CNY', 'CNY', 7.2)).toBe(100);
  });

  it('fxOn：指定日期 forward-fill（取 <= date 最近快照）', () => {
    expect(fxOn(FX, 'USD', 'CNY', '2026-07-15')).toBeCloseTo(7.1, 6);
    expect(fxOn(FX, 'USD', 'CNY', '2026-08-01')).toBeCloseTo(7.2, 6);
    expect(fxOn(FX, 'USD', 'CNY', '2026-08-10')).toBeCloseTo(7.2, 6);
  });

  it('fxOn：早于所有快照时回退到最新汇率（不崩溃）', () => {
    const rate = fxOn(FX, 'USD', 'CNY', '2026-01-01');
    expect(rate).toBeGreaterThan(0);
  });

  it('HKD→CNY 使用独立汇率键', () => {
    expect(fxOn(FX, 'HKD', 'CNY', '2026-08-10')).toBeCloseTo(0.92, 6);
  });
});

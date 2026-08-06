import { describe, expect, it } from 'vitest';
import { searchSymbols, SYMBOL_INDEX, SymbolSuggestion } from '@/data/symbols';

/** 取候选列表的 code 数组，便于断言 */
function codesOf(list: SymbolSuggestion[]): string[] {
  return list.map((s) => s.code);
}

describe('searchSymbols', () => {
  it('空串返回 []', () => {
    expect(searchSymbols('')).toEqual([]);
  });

  it('纯空格返回 []', () => {
    expect(searchSymbols('   ')).toEqual([]);
  });

  it('code 前缀匹配：600519 命中 600519.SH', () => {
    const res = searchSymbols('600519');
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].code).toBe('600519.SH');
    expect(res[0].name).toBe('贵州茅台');
    expect(res[0].market).toBe('A_SHARE');
    expect(res[0].currency).toBe('CNY');
    expect(res[0].securityType).toBe('COMMON');
    expect(res[0].custodyChannel).toBe('CN_BROKER');
  });

  it('忽略 .SH/.SZ/.HK 后缀：00700 命中 00700.HK', () => {
    const res = searchSymbols('00700');
    expect(codesOf(res)).toContain('00700.HK');
    expect(res[0].code).toBe('00700.HK');
    expect(res[0].name).toBe('腾讯控股');
    expect(res[0].currency).toBe('HKD');
  });

  it('精确 code 匹配：AAPL 命中 AAPL 且排第一', () => {
    const res = searchSymbols('AAPL');
    expect(res[0].code).toBe('AAPL');
    expect(res[0].name).toBe('Apple Inc.');
    expect(res[0].market).toBe('US');
    expect(res[0].custodyChannel).toBe('US_BROKER');
  });

  it('大小写无关：aapl 命中 AAPL', () => {
    const res = searchSymbols('aapl');
    expect(res[0].code).toBe('AAPL');
    expect(res[0].name).toBe('Apple Inc.');
  });

  it('name 中文子串：茅台 命中 贵州茅台', () => {
    const res = searchSymbols('茅台');
    expect(codesOf(res)).toContain('600519.SH');
    const hit = res.find((s) => s.code === '600519.SH');
    expect(hit?.name).toBe('贵州茅台');
  });

  it('name 英文子串大小写无关：apple 命中 Apple Inc.', () => {
    const res = searchSymbols('apple');
    expect(codesOf(res)).toContain('AAPL');
  });

  it('code 前缀优先于 name 子串', () => {
    // '00' 是多条港股 code 的前缀，应排在仅 name 命中的条目之前
    const res = searchSymbols('00', 20);
    expect(res[0].code.replace(/\.(SH|SZ|HK)$/, '').startsWith('00')).toBe(true);
  });

  it('limit 截断：默认 8 条上限', () => {
    const res = searchSymbols('0');
    expect(res.length).toBeLessThanOrEqual(8);
  });

  it('limit 截断：显式传入 limit 生效', () => {
    const res = searchSymbols('0', 3);
    expect(res.length).toBe(3);
  });

  it('limit <= 0 返回 []', () => {
    expect(searchSymbols('600519', 0)).toEqual([]);
  });

  it('无命中返回 []', () => {
    expect(searchSymbols('ZZZZ_NOT_EXIST_9999')).toEqual([]);
  });

  it('trim 归一：前后空格不影响命中', () => {
    const res = searchSymbols('  AAPL  ');
    expect(res[0].code).toBe('AAPL');
  });

  it('纯函数：重复调用结果一致且不修改 SYMBOL_INDEX', () => {
    const before = SYMBOL_INDEX.length;
    const a = searchSymbols('600519');
    const b = searchSymbols('600519');
    expect(codesOf(a)).toEqual(codesOf(b));
    expect(SYMBOL_INDEX.length).toBe(before);
  });
});

describe('SYMBOL_INDEX', () => {
  it('code 无重复', () => {
    const codes = SYMBOL_INDEX.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('包含六类资产的种子标的', () => {
    const codes = SYMBOL_INDEX.map((s) => s.code);
    ['600519.SH', '000001.SZ', '00700.HK', 'AAPL', '110011', 'BTC', 'Au99.99'].forEach((c) => {
      expect(codes).toContain(c);
    });
  });

  it('每条候选字段完整非空', () => {
    SYMBOL_INDEX.forEach((s) => {
      expect(s.code.length).toBeGreaterThan(0);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.market.length).toBeGreaterThan(0);
      expect(s.currency.length).toBeGreaterThan(0);
      expect(s.securityType.length).toBeGreaterThan(0);
      expect(s.custodyChannel.length).toBeGreaterThan(0);
    });
  });
});

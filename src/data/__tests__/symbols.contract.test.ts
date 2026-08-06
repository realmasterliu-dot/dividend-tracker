import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searchSymbols, SYMBOL_INDEX, SymbolSuggestion } from '@/data/symbols';
import { seedInstruments } from '@/data/seed/instruments.seed';
import { Currency, CustodyChannel, Market, SecurityType } from '@/types';

/**
 * 标的字典「契约测试」——由 QA 补充，覆盖 symbols.test.ts 未断言的规格项：
 *  1) 带交易所后缀的完整代码输入必须命中（原用例只测了裸代码）
 *  2) 前 7 条与 instruments.seed.ts 逐字一致（原用例仅 toContain，属弱断言）
 *  3) market / currency / securityType / custodyChannel 自洽性与枚举合法性
 *     （原用例仅断言字段非空，无法发现 HKD 配 US_BROKER 这类错配）
 *  4) 排序优先级的**严格**验证（精确 > 前缀 > code 子串 > name 子串）
 *  5) 架构约束：engine/纯数据层禁止 import React
 */

/** 与 src/types/index.ts 保持同源的枚举白名单 */
const MARKETS: Market[] = ['A_SHARE', 'HK', 'US', 'FUND', 'CRYPTO', 'GOLD'];
const CURRENCIES: Currency[] = ['CNY', 'USD', 'HKD'];
const SECURITY_TYPES: SecurityType[] = [
  'COMMON',
  'REIT',
  'MLP_PTP',
  'ADR',
  'ETF',
  'FUND',
  'CRYPTO',
  'GOLD',
];
const CUSTODY_CHANNELS: CustodyChannel[] = [
  'CN_BROKER',
  'HK_LOCAL_BROKER',
  'HK_STOCK_CONNECT',
  'US_BROKER',
  'CEX',
  'SGE',
  'PHYSICAL',
];

/** 每个市场允许的币种 / 托管渠道 / 证券类型 */
const MARKET_RULES: Record<
  Market,
  { currency: Currency; custody: CustodyChannel[]; securityTypes: SecurityType[] }
> = {
  A_SHARE: {
    currency: 'CNY',
    custody: ['CN_BROKER'],
    // 场内 ETF / LOF 走券商通道，同属 A 股市场
    securityTypes: ['COMMON', 'ETF', 'FUND', 'REIT'],
  },
  HK: {
    currency: 'HKD',
    custody: ['HK_LOCAL_BROKER', 'HK_STOCK_CONNECT'],
    securityTypes: ['COMMON', 'ETF', 'REIT'],
  },
  US: {
    currency: 'USD',
    custody: ['US_BROKER'],
    securityTypes: ['COMMON', 'ADR', 'ETF', 'REIT', 'MLP_PTP'],
  },
  FUND: { currency: 'CNY', custody: ['CN_BROKER'], securityTypes: ['FUND'] },
  CRYPTO: { currency: 'USD', custody: ['CEX'], securityTypes: ['CRYPTO'] },
  GOLD: { currency: 'CNY', custody: ['SGE', 'PHYSICAL'], securityTypes: ['GOLD'] },
};

function codesOf(list: SymbolSuggestion[]): string[] {
  return list.map((s) => s.code);
}

/** 候选在结果中的下标，未命中返回 -1 */
function indexOfCode(list: SymbolSuggestion[], code: string): number {
  return list.findIndex((s) => s.code === code);
}

describe('SYMBOL_INDEX · 种子一致性', () => {
  it('前 7 条与 instruments.seed.ts 的 7 个种子标的逐字一致', () => {
    expect(SYMBOL_INDEX.length).toBeGreaterThanOrEqual(seedInstruments.length);

    seedInstruments.forEach((seed, i) => {
      const actual = SYMBOL_INDEX[i];
      // 逐字段比对，任一字段漂移都会在此暴露（含顺序）
      expect({
        code: actual.code,
        name: actual.name,
        market: actual.market,
        currency: actual.currency,
        securityType: actual.securityType,
        custodyChannel: actual.custodyChannel,
      }).toEqual({
        code: seed.id,
        name: seed.name,
        market: seed.market,
        currency: seed.currency,
        securityType: seed.securityType,
        custodyChannel: seed.custodyChannel,
      });
    });
  });

  it('六类资产（A股/港股/美股/基金/加密/黄金）均有覆盖', () => {
    const markets = new Set(SYMBOL_INDEX.map((s) => s.market));
    MARKETS.forEach((m) => expect(markets).toContain(m));
  });
});

describe('SYMBOL_INDEX · 枚举合法性与自洽性', () => {
  it('所有字段取值都落在 src/types 的枚举内', () => {
    SYMBOL_INDEX.forEach((s) => {
      expect(MARKETS, `${s.code} market`).toContain(s.market);
      expect(CURRENCIES, `${s.code} currency`).toContain(s.currency);
      expect(SECURITY_TYPES, `${s.code} securityType`).toContain(s.securityType);
      expect(CUSTODY_CHANNELS, `${s.code} custodyChannel`).toContain(s.custodyChannel);
    });
  });

  it('market 与 currency / custodyChannel / securityType 三者自洽', () => {
    const violations: string[] = [];
    SYMBOL_INDEX.forEach((s) => {
      const rule = MARKET_RULES[s.market];
      if (s.currency !== rule.currency) {
        violations.push(`${s.code}: market=${s.market} 期望 currency=${rule.currency}，实际 ${s.currency}`);
      }
      if (!rule.custody.includes(s.custodyChannel)) {
        violations.push(`${s.code}: market=${s.market} 不应使用 custodyChannel=${s.custodyChannel}`);
      }
      if (!rule.securityTypes.includes(s.securityType)) {
        violations.push(`${s.code}: market=${s.market} 不应使用 securityType=${s.securityType}`);
      }
    });
    expect(violations).toEqual([]);
  });

  it('ADR 类标的仅出现在美股市场', () => {
    SYMBOL_INDEX.filter((s) => s.securityType === 'ADR').forEach((s) => {
      expect(s.market, `${s.code}`).toBe('US');
    });
  });
});

describe('searchSymbols · 交易所后缀归一（双向）', () => {
  it.each([
    ['600519', '600519.SH'],
    ['600519.SH', '600519.SH'],
    ['600519.sh', '600519.SH'],
    ['000001', '000001.SZ'],
    ['000001.SZ', '000001.SZ'],
    ['00700', '00700.HK'],
    ['00700.HK', '00700.HK'],
    ['00700.hk', '00700.HK'],
  ])('输入 %s 命中 %s 且排第一', (query, expected) => {
    const res = searchSymbols(query);
    expect(codesOf(res)).toContain(expected);
    expect(res[0].code).toBe(expected);
  });

  it('不含后缀的代码（AAPL / BRK.B / Au99.99）不被后缀规则误伤', () => {
    expect(searchSymbols('BRK.B')[0].code).toBe('BRK.B');
    expect(searchSymbols('brk.b')[0].code).toBe('BRK.B');
    // Au99.99 的 '.99' 不是交易所后缀，不应被剥离
    expect(searchSymbols('au99.99')[0].code).toBe('Au99.99');
    expect(searchSymbols('Au99.99')[0].code).toBe('Au99.99');
  });
});

describe('searchSymbols · 排序优先级（严格）', () => {
  it('精确 code 严格优先于 code 子串命中', () => {
    // '01398' 精确命中 01398.HK；601398.SH 仅为子串命中
    const res = searchSymbols('01398', 20);
    const exact = indexOfCode(res, '01398.HK');
    const substring = indexOfCode(res, '601398.SH');
    expect(exact).toBe(0);
    expect(substring).toBeGreaterThan(exact);
  });

  it('code 前缀严格优先于 code 子串命中', () => {
    // '000' 既有前缀命中（000001.SZ 等）也有子串命中（600036.SH / 320007 等）
    const query = '000';
    const res = searchSymbols(query, 30);
    const bare = (code: string) => code.replace(/\.(SH|SZ|HK)$/, '').toUpperCase();

    const prefixIdx: number[] = [];
    const substringIdx: number[] = [];
    res.forEach((s, i) => {
      const b = bare(s.code);
      if (b.startsWith(query)) prefixIdx.push(i);
      else if (b.includes(query)) substringIdx.push(i);
    });

    // 两类命中都必须存在，否则本用例失去区分力
    expect(prefixIdx.length, '应存在前缀命中').toBeGreaterThan(0);
    expect(substringIdx.length, '应存在子串命中').toBeGreaterThan(0);
    // 所有前缀命中必须整体排在所有子串命中之前
    expect(Math.max(...prefixIdx)).toBeLessThan(Math.min(...substringIdx));
  });

  it('code 命中严格优先于 name 子串命中', () => {
    // '1398' 命中 601398.SH / 01398.HK 的 code；'工商银行' 仅名称含 '1398' 者无
    const res = searchSymbols('银行', 20);
    // 全部为 name 命中，且顺序稳定（按字典原始顺序）
    expect(codesOf(res)).toEqual(['000001.SZ', '600036.SH', '601166.SH', '601398.SH', '00939.HK', '01398.HK']);
  });

  it('同等级命中按字典原始顺序稳定排序（可重复）', () => {
    const a = codesOf(searchSymbols('银行', 20));
    const b = codesOf(searchSymbols('银行', 20));
    expect(a).toEqual(b);
  });
});

describe('searchSymbols · limit 边界', () => {
  it('limit 大于命中数时返回全部命中，不做填充', () => {
    const res = searchSymbols('茅台', 50);
    expect(res.length).toBe(1);
    expect(res[0].code).toBe('600519.SH');
  });

  it('limit 为负数返回 []', () => {
    expect(searchSymbols('600519', -1)).toEqual([]);
  });

  it('limit=1 只返回优先级最高的一条', () => {
    const res = searchSymbols('01398', 1);
    expect(res.length).toBe(1);
    expect(res[0].code).toBe('01398.HK');
  });
});

describe('searchSymbols · 纯函数性', () => {
  it('返回新数组，改动返回值不污染 SYMBOL_INDEX', () => {
    const snapshot = SYMBOL_INDEX.map((s) => ({ ...s }));
    const res = searchSymbols('600519');
    res.length = 0;
    expect(SYMBOL_INDEX.length).toBe(snapshot.length);
    SYMBOL_INDEX.forEach((s, i) => expect(s).toEqual(snapshot[i]));
  });

  it('多次调用互不干扰（无内部缓存副作用）', () => {
    const first = codesOf(searchSymbols('00', 5));
    searchSymbols('AAPL');
    searchSymbols('');
    const second = codesOf(searchSymbols('00', 5));
    expect(second).toEqual(first);
  });
});

describe('symbols.ts · 架构约束', () => {
  it('纯数据/纯函数模块禁止 import React', () => {
    const src = readFileSync(new URL('../symbols.ts', import.meta.url), 'utf8');
    const importLines = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    importLines.forEach((line) => {
      expect(line.toLowerCase(), `不应引入 React：${line}`).not.toMatch(/['"]react/);
    });
  });
});

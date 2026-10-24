import { Currency, CustodyChannel, Market, SecurityType } from '@/types';

/**
 * 客户端内置标的字典 —— 符合「无运行时后端」架构。
 *
 * 用于「新增持仓」弹窗的标的自动匹配（autocomplete）：用户输入代码/名称时，
 * 由 {@link searchSymbols} 给出候选，一键带出代码/名称/市场/币种/证券类型/托管渠道。
 *
 * 注意：这是**精选**字典而非全量清单，用户仍可自由文本手输任意代码（兜底路径）。
 */

/** 自动匹配候选项：与 Instrument 的可推导字段一一对应 */
export interface SymbolSuggestion {
  /** 即 instrument.id，如 '600519.SH' / 'AAPL' / '110011' */
  code: string;
  /** 如 '贵州茅台' */
  name: string;
  market: Market;
  currency: Currency;
  securityType: SecurityType;
  custodyChannel: CustodyChannel;
}

/** A 股默认组合（CNY / A_SHARE / CN_BROKER） */
function aShare(code: string, name: string, securityType: SecurityType = 'COMMON'): SymbolSuggestion {
  return { code, name, market: 'A_SHARE', currency: 'CNY', securityType, custodyChannel: 'CN_BROKER' };
}

/** 港股默认组合（HKD / HK / HK_LOCAL_BROKER） */
function hkShare(code: string, name: string, securityType: SecurityType = 'COMMON'): SymbolSuggestion {
  return { code, name, market: 'HK', currency: 'HKD', securityType, custodyChannel: 'HK_LOCAL_BROKER' };
}

/** 美股默认组合（USD / US / US_BROKER） */
function usShare(code: string, name: string, securityType: SecurityType = 'COMMON'): SymbolSuggestion {
  return { code, name, market: 'US', currency: 'USD', securityType, custodyChannel: 'US_BROKER' };
}

/** 场外基金默认组合（CNY / FUND / CN_BROKER） */
function fund(code: string, name: string, securityType: SecurityType = 'FUND'): SymbolSuggestion {
  return { code, name, market: 'FUND', currency: 'CNY', securityType, custodyChannel: 'CN_BROKER' };
}

/**
 * 内置精选标的字典。
 * 前 7 条与 `src/data/seed/instruments.seed.ts` 的种子标的逐字对应（六类资产覆盖）。
 */
export const SYMBOL_INDEX: SymbolSuggestion[] = [
  // ---- 种子标的（与 instruments.seed.ts 保持一致）----
  aShare('600519.SH', '贵州茅台'),
  aShare('000001.SZ', '平安银行'),
  hkShare('00700.HK', '腾讯控股'),
  usShare('AAPL', 'Apple Inc.'),
  fund('110011', '易方达优质精选混合'),
  { code: 'BTC', name: 'Bitcoin', market: 'CRYPTO', currency: 'USD', securityType: 'CRYPTO', custodyChannel: 'CEX' },
  { code: 'Au99.99', name: '上金所黄金 Au99.99', market: 'GOLD', currency: 'CNY', securityType: 'GOLD', custodyChannel: 'SGE' },

  // ---- A 股 ----
  aShare('000858.SZ', '五粮液'),
  aShare('601318.SH', '中国平安'),
  aShare('600036.SH', '招商银行'),
  aShare('600276.SH', '恒瑞医药'),
  aShare('000651.SZ', '格力电器'),
  aShare('600887.SH', '伊利股份'),
  aShare('601166.SH', '兴业银行'),
  aShare('300750.SZ', '宁德时代'),
  aShare('002594.SZ', '比亚迪'),
  aShare('600900.SH', '长江电力'),
  aShare('000333.SZ', '美的集团'),
  aShare('601398.SH', '工商银行'),
  aShare('600030.SH', '中信证券'),
  aShare('600009.SH', '上海机场'),
  aShare('000002.SZ', '万科A'),
  aShare('601857.SH', '中国石油'),
  aShare('600028.SH', '中国石化'),
  aShare('510300.SH', '沪深300ETF', 'ETF'),
  aShare('510050.SH', '上证50ETF', 'ETF'),
  aShare('518880.SH', '黄金ETF', 'ETF'),
  aShare('161725.SZ', '招商中证白酒指数', 'FUND'),

  // ---- 港股 ----
  hkShare('09988.HK', '阿里巴巴-SW'),
  hkShare('03690.HK', '美团-W'),
  hkShare('01810.HK', '小米集团-W'),
  hkShare('09618.HK', '京东集团-SW'),
  hkShare('00939.HK', '建设银行'),
  hkShare('01398.HK', '工商银行'),
  hkShare('00005.HK', '汇丰控股'),
  hkShare('02318.HK', '中国平安'),
  hkShare('00883.HK', '中国海洋石油'),
  hkShare('01299.HK', '友邦保险'),

  // ---- 美股 ----
  usShare('MSFT', 'Microsoft Corp.'),
  usShare('GOOGL', 'Alphabet Inc.'),
  usShare('AMZN', 'Amazon.com Inc.'),
  usShare('NVDA', 'NVIDIA Corp.'),
  usShare('TSLA', 'Tesla Inc.'),
  usShare('JPM', 'JPMorgan Chase & Co.'),
  usShare('BRK.B', 'Berkshire Hathaway B'),
  usShare('KO', 'The Coca-Cola Co.'),
  usShare('V', 'Visa Inc.'),
  usShare('JNJ', 'Johnson & Johnson'),
  usShare('PG', 'Procter & Gamble'),
  usShare('MA', 'Mastercard Inc.'),
  usShare('DIS', 'Walt Disney Co.'),
  usShare('BABA', 'Alibaba Group(ADR)', 'ADR'),
  usShare('PDD', 'PDD Holdings Inc.', 'ADR'),
  usShare('NEE', 'NextEra Energy Inc.'),

  // ---- 场外基金 ----
  fund('163406', '兴全合宜混合'),
  fund('005827', '易方达蓝筹精选混合'),
  fund('320007', '诺安成长混合'),
  fund('110020', '易方达沪深300ETF联接'),

  // ---- 加密 ----
  { code: 'ETH', name: 'Ethereum', market: 'CRYPTO', currency: 'USD', securityType: 'CRYPTO', custodyChannel: 'CEX' },
];

/**
 * The bundled data pipeline currently refreshes only these instruments.
 * Other symbols remain valid ledger entries, but their valuation falls back
 * to cost until the pipeline is extended or a price is imported manually.
 */
const AUTOMATIC_MARKET_DATA_CODES = new Set([
  '600519.SH',
  '000001.SZ',
  '00700.HK',
  'AAPL',
  '110011',
  'BTC',
  'AU99.99',
]);

export function hasAutomaticMarketData(code: string): boolean {
  return AUTOMATIC_MARKET_DATA_CODES.has(code.trim().toUpperCase());
}

/** 匹配时忽略的交易所后缀（如 600519.SH → 600519） */
const EXCHANGE_SUFFIX_RE = /\.(SH|SZ|HK)$/;

/** 命中等级：数值越小优先级越高（精确 code > code 前缀 > code 子串 > name 子串） */
const RANK_EXACT_CODE = 0;
const RANK_CODE_PREFIX = 1;
const RANK_CODE_SUBSTRING = 2;
const RANK_NAME_SUBSTRING = 3;
const RANK_MISS = 99;

/** 去掉交易所后缀（已大写的 code 上调用） */
function stripSuffix(upperCode: string): string {
  return upperCode.replace(EXCHANGE_SUFFIX_RE, '');
}

/**
 * 计算单条候选对 query 的命中等级。
 * @param item 候选标的
 * @param upperQuery 归一（trim + toUpperCase）后的查询串
 * @param rawQuery 原始（仅 trim）查询串，用于中文名匹配
 * @returns 命中等级，未命中返回 RANK_MISS
 */
function matchRank(item: SymbolSuggestion, upperQuery: string, rawQuery: string): number {
  const upperCode = item.code.toUpperCase();
  const bareCode = stripSuffix(upperCode);

  // 1) 精确相等（含忽略后缀的相等，如 '600519' === '600519.SH' 去后缀）
  if (upperCode === upperQuery || bareCode === upperQuery) return RANK_EXACT_CODE;
  // 2) code 前缀
  if (upperCode.startsWith(upperQuery) || bareCode.startsWith(upperQuery)) return RANK_CODE_PREFIX;
  // 3) code 子串
  if (upperCode.includes(upperQuery) || bareCode.includes(upperQuery)) return RANK_CODE_SUBSTRING;
  // 4) name 子串（大小写无关；中文名按子串）
  if (item.name.toUpperCase().includes(rawQuery.toUpperCase())) return RANK_NAME_SUBSTRING;
  return RANK_MISS;
}

/**
 * 在内置字典中搜索标的候选。纯函数、无副作用、不依赖 React。
 *
 * @param query 用户输入（代码或名称片段）
 * @param limit 最多返回条数，默认 8
 * @returns 按命中优先级排序后的候选列表；空串 / 纯空格 / 无命中均返回 []
 */
export function searchSymbols(query: string, limit = 8): SymbolSuggestion[] {
  const rawQuery = query.trim();
  if (rawQuery.length === 0) return [];
  if (limit <= 0) return [];
  const upperQuery = rawQuery.toUpperCase();

  const hits: { item: SymbolSuggestion; rank: number; index: number }[] = [];
  SYMBOL_INDEX.forEach((item, index) => {
    const rank = matchRank(item, upperQuery, rawQuery);
    if (rank !== RANK_MISS) hits.push({ item, rank, index });
  });

  // 同等级按字典原始顺序稳定排序
  hits.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index));
  return hits.slice(0, limit).map((h) => h.item);
}

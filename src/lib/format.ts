import { Currency, Market } from '@/types';

/**
 * 数字/货币/百分比格式化（architecture.md §8.2 数字规范）
 * 全部数字：千分位 + 小数位按资产类型固定 + 等宽（由 CSS .num 保证）。
 */

export function formatNumber(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const [int, dec] = abs.toFixed(digits).split('.');
  const intWithSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return digits > 0 ? `${sign}${intWithSep}.${dec}` : `${sign}${intWithSep}`;
}

export function currencySymbol(currency: Currency): string {
  switch (currency) {
    case 'CNY':
      return '¥';
    case 'USD':
      return '$';
    case 'HKD':
      return 'HK$';
    default:
      return '';
  }
}

export function formatMoney(n: number, currency: Currency = 'CNY', digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `${currencySymbol(currency)}${formatNumber(n, digits)}`;
}

/** 涨跌带符号：+12,345.67 / -1,234.56 */
export function formatSigned(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n, digits)}`;
}

export function formatPercent(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n * 100, digits)}%`;
}

export function formatPctPlain(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `${formatNumber(n * 100, digits)}%`;
}

/** 按市场定小数位（PRD §8.3）：股票 2 位 / 加密 4-8 位 / 份额 2-4 位 */
export function marketDigits(market: Market): number {
  switch (market) {
    case 'CRYPTO':
      return 4;
    case 'GOLD':
      return 2;
    default:
      return 2;
  }
}

export function formatQuantity(n: number, market: Market): string {
  if (!Number.isFinite(n)) return '—';
  if (market === 'CRYPTO') {
    if (Math.abs(n) < 0.01) return formatNumber(n, 6);
    if (Math.abs(n) < 1) return formatNumber(n, 4);
    return formatNumber(n, 4);
  }
  return formatNumber(n, 2);
}

/** 大数缩写：12.3万 / 1.2亿 / 34.5K / 2.1M（紧凑卡片用） */
export function formatCompact(n: number, currency: Currency = 'CNY'): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const symbol = currencySymbol(currency);
  const sign = n < 0 ? '-' : '';
  if (currency === 'CNY') {
    if (abs >= 1e8) return `${sign}${symbol}${formatNumber(abs / 1e8, 2)}亿`;
    if (abs >= 1e4) return `${sign}${symbol}${formatNumber(abs / 1e4, 2)}万`;
  } else {
    if (abs >= 1e6) return `${sign}${symbol}${formatNumber(abs / 1e6, 2)}M`;
    if (abs >= 1e3) return `${sign}${symbol}${formatNumber(abs / 1e3, 2)}K`;
  }
  return `${sign}${symbol}${formatNumber(abs, 2)}`;
}

/** 稳定性评分 → ●●●○○ 形态 */
export function stabilityDots(score: number): string {
  const filled = Math.max(0, Math.min(5, score));
  return '●'.repeat(filled) + '○'.repeat(5 - filled);
}

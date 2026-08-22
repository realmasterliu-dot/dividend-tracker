/**
 * 设计 token 唯一来源（architecture.md §8.1）
 * 所有颜色/字体/字号/间距/行高常量在此定义；
 * 运行值由 theme.ts 注入为 CSS 变量，Tailwind 通过 var() 引用。
 */
export const COLORS = {
  // 基础色
  bgPage: '#0A0E14',
  bgCard: '#161C26',
  bgCardHover: '#1B2330',
  borderDefault: '#1F2733',
  borderSoft: '#232C3B',
  textPrimary: '#E6EAF0',
  textSecondary: '#8B96A8',
  textDisabled: '#4A5468',

  // ★ 分红金色（核心语义色，与涨跌色完全区分）
  goldDividend: '#F0B90B',
  goldSoft: 'rgba(240, 185, 11, 0.12)',

  // 状态色
  statusDeclared: '#00BCD4',
  statusPrediction: '#5A6478',
  statusWarning: '#FFA726',
  statusError: '#EF5350',
  statusHealthy: '#26A69A',

  // 涨跌色三档（随 data-scheme 切换，见 theme.ts）
  schemeUp: '#EF5350',
  schemeDown: '#26A69A',
  schemeUpSoft: 'rgba(239, 83, 80, 0.10)',
  schemeDownSoft: 'rgba(38, 166, 154, 0.10)',
  schemeUpStrong: 'rgba(239, 83, 80, 0.16)',
  schemeDownStrong: 'rgba(38, 166, 154, 0.16)',
} as const;

export const COLOR_SCHEMES = {
  cn: {
    label: '中国习惯（红涨绿跌）',
    up: '#EF5350',
    down: '#26A69A',
    upSoft: 'rgba(239, 83, 80, 0.10)',
    downSoft: 'rgba(38, 166, 154, 0.10)',
    upStrong: 'rgba(239, 83, 80, 0.16)',
    downStrong: 'rgba(38, 166, 154, 0.16)',
  },
  intl: {
    label: '国际习惯（绿涨红跌）',
    up: '#26A69A',
    down: '#EF5350',
    upSoft: 'rgba(38, 166, 154, 0.10)',
    downSoft: 'rgba(239, 83, 80, 0.10)',
    upStrong: 'rgba(38, 166, 154, 0.16)',
    downStrong: 'rgba(239, 83, 80, 0.16)',
  },
  colorblind: {
    label: '色盲友好（蓝涨橙跌）',
    up: '#42A5F5',
    down: '#FFA726',
    upSoft: 'rgba(66, 165, 245, 0.12)',
    downSoft: 'rgba(255, 167, 38, 0.12)',
    upStrong: 'rgba(66, 165, 245, 0.18)',
    downStrong: 'rgba(255, 167, 38, 0.18)',
  },
} as const;

export const FONT = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  sans: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif',
} as const;

export const SPACING = {
  pageX: '20px',
  cardPadding: '16px',
  rowHeight: '34px', // 密集表格行高 32-36px
} as const;

export const FONT_SIZE = {
  hero: '52px', // 总资产 48-56px
  table: '13px',
  tableSm: '12px',
} as const;

/** CSS 变量名 → 值（theme.ts 注入用） */
export const CSS_VARS: Record<string, string> = {
  '--bg-page': COLORS.bgPage,
  '--bg-card': COLORS.bgCard,
  '--bg-card-hover': COLORS.bgCardHover,
  '--border-default': COLORS.borderDefault,
  '--border-soft': COLORS.borderSoft,
  '--text-primary': COLORS.textPrimary,
  '--text-secondary': COLORS.textSecondary,
  '--text-disabled': COLORS.textDisabled,
  '--gold-dividend': COLORS.goldDividend,
  '--gold-soft': COLORS.goldSoft,
  '--status-declared': COLORS.statusDeclared,
  '--status-prediction': COLORS.statusPrediction,
  '--status-warning': COLORS.statusWarning,
  '--status-error': COLORS.statusError,
  '--status-healthy': COLORS.statusHealthy,
};

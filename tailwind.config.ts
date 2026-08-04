import type { Config } from 'tailwindcss';

// 设计 token 唯一来源为 src/styles/tokens.ts；
// 此处全部通过 CSS 变量（由 src/styles/theme.ts 注入）引用，保证单源与运行时切换。
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--bg-page)',
        card: 'var(--bg-card)',
        'card-hover': 'var(--bg-card-hover)',
        line: 'var(--border-default)',
        'line-soft': 'var(--border-soft)',
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        disabled: 'var(--text-disabled)',
        gold: 'var(--gold-dividend)',
        'gold-soft': 'var(--gold-soft)',
        declared: 'var(--status-declared)',
        prediction: 'var(--status-prediction)',
        warning: 'var(--status-warning)',
        danger: 'var(--status-error)',
        healthy: 'var(--status-healthy)',
        up: 'var(--scheme-up)',
        down: 'var(--scheme-down)',
        'up-soft': 'var(--scheme-up-soft)',
        'down-soft': 'var(--scheme-down-soft)',
        'up-strong': 'var(--scheme-up-strong)',
        'down-strong': 'var(--scheme-down-strong)',
      },
      fontFamily: {
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          '"Helvetica Neue"',
          'sans-serif',
        ],
      },
      fontSize: {
        hero: ['52px', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'table-cell': ['13px', { lineHeight: '20px' }],
        'table-cell-sm': ['12px', { lineHeight: '18px' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4)',
        glow: '0 0 0 1px rgba(240,185,11,0.25)',
      },
    },
  },
  plugins: [],
} satisfies Config;

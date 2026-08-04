import { AppSettings } from '@/types';

/**
 * 默认设置（architecture.md §9 开放问题默认化）：
 * Q1 本位币 CNY / Q2 W-8BEN 未填(30%保守) / Q4 中国习惯红涨绿跌 / Q3 黄金实物金条
 */
export const seedSettings: AppSettings = {
  baseCurrency: 'CNY',
  displayCurrency: 'CNY',
  colorScheme: 'CN',
  w8benFilled: false,
  fxNeutralMode: false,
  annualIncomeTarget: 50000,
  notificationChannels: {},
  quietHours: { start: '23:00', end: '08:00' },
  stalenessThresholdHours: 48,
};

import { InvestmentPlan } from '@/types';

/**
 * 种子定投计划（PRD §5.4）
 * 基金每月 10 号 ¥1,000；BTC 每周一 $200；均 autoConfirm=false（诚实做法）
 */
export const seedPlans: InvestmentPlan[] = [
  {
    id: 'plan-110011',
    instrumentId: '110011',
    amount: 1000,
    frequency: 'MONTHLY',
    executionDay: 10,
    startDate: '2026-01-10',
    holidayPolicy: 'NEXT_TRADING_DAY',
    monthEndPolicy: 'LAST_TRADING_DAY',
    autoConfirm: false,
    status: 'ACTIVE',
    nextRunDate: '2026-08-10',
  },
  {
    id: 'plan-btc',
    instrumentId: 'BTC',
    amount: 200,
    frequency: 'WEEKLY',
    executionDay: 1, // 周一
    startDate: '2026-02-02',
    holidayPolicy: 'NEXT_TRADING_DAY',
    monthEndPolicy: 'LAST_TRADING_DAY',
    autoConfirm: false,
    status: 'ACTIVE',
    nextRunDate: '2026-08-03',
  },
];

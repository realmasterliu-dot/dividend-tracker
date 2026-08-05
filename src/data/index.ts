import { DataState, Notification } from '@/types';
import { SEED_TODAY } from '@/lib/clock';
import { generate } from '@/lib/notification';
import { seedDividends } from './seed/dividends.seed';
import { seedInstruments } from './seed/instruments.seed';
import { seedPlans } from './seed/plans.seed';
import { seedFx, seedPrices } from './seed/prices.seed';
import { seedSettings } from './seed/settings.seed';
import { seedTransactions } from './seed/transactions.seed';

/**
 * 数据聚合器。
 * - buildPersonalState()：仅个人数据（标的/流水/计划），市场数据留空，等真实管道 hydrate 填充。
 * - buildSeedState()：个人数据 + 种子行情，纯离线演示/回归用，不参与真实数据启动路径。
 * 通知由 NotificationService.generate 依据数据生成（去重 key 校验）。
 */

const SEED_SOURCE_HEALTH: DataState['sourceHealth'] = {
  'akshare·A股行情': { lastSuccess: `${SEED_TODAY}T16:00:00Z`, consecutiveFailures: 0, status: 'GREEN' },
  'akshare·A股分红': { lastSuccess: `${SEED_TODAY}T07:00:00Z`, consecutiveFailures: 0, status: 'GREEN' },
  'yfinance·美股': { lastSuccess: `${SEED_TODAY}T06:00:00Z`, consecutiveFailures: 0, status: 'GREEN' },
  '同花顺·港股分红': { lastSuccess: '2026-08-01T07:00:00Z', consecutiveFailures: 3, status: 'RED' },
  '天天基金·净值': { lastSuccess: `${SEED_TODAY}T21:00:00Z`, consecutiveFailures: 0, status: 'GREEN' },
  CoinGecko: { lastSuccess: `${SEED_TODAY}T06:00:00Z`, consecutiveFailures: 0, status: 'GREEN' },
  '上金所·黄金': { lastSuccess: `${SEED_TODAY}T16:00:00Z`, consecutiveFailures: 0, status: 'GREEN' },
  'Frankfurter·汇率': { lastSuccess: `${SEED_TODAY}T06:00:00Z`, consecutiveFailures: 0, status: 'GREEN' },
};

/**
 * 个人数据基线：标的 / 流水 / 定投计划来自种子（个人数据 JSON 化为后续任务）。
 * 市场数据切片留空，由 realData.loadMarketData() 在启动时用 public/data 真实数据填充，
 * 从而杜绝"先渲染假行情再被真实数据覆盖"的闪烁。
 */
export function buildPersonalState(): DataState {
  return {
    instruments: seedInstruments,
    transactions: seedTransactions,
    dividends: [],
    plans: seedPlans,
    notifications: [],
    prices: [],
    fx: [],
    lastUpdated: '',
    sourceHealth: {},
  };
}

export function buildSeedState(): DataState {
  const base: DataState = {
    ...buildPersonalState(),
    dividends: seedDividends,
    prices: seedPrices,
    fx: seedFx,
    lastUpdated: `${SEED_TODAY}T07:00:00Z`,
    sourceHealth: SEED_SOURCE_HEALTH,
  };

  const generated: Notification[] = generate(base, seedSettings.stalenessThresholdHours, SEED_TODAY);

  return {
    ...base,
    notifications: [
      {
        id: 'ntf-demo-bracket',
        key: 'demo|TAX_BRACKET|2026-08-04',
        type: 'TAX_BRACKET',
        title: '税档提醒：000001.SZ 即将跨入免税档',
        body: '送转股批次持股满 1 年（起算日 2024-08-01），再持有 7 天，或有税负将归零',
        severity: 'INFO',
        createdAt: `${SEED_TODAY}T07:00:00Z`,
        read: false,
        relatedInstrumentId: '000001.SZ',
      },
      ...generated,
    ],
  };
}

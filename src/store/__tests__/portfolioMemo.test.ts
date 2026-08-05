import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppSettings, DataState } from '@/types';
import { normalizeDividends, normalizeFx, normalizePrices } from '@/data/realData';
import { seedInstruments } from '@/data/seed/instruments.seed';
import { seedPlans } from '@/data/seed/plans.seed';
import { seedTransactions } from '@/data/seed/transactions.seed';
import { PortfolioDerived, clearPortfolioCache, derivePortfolio } from '../selectors';

/**
 * derivePortfolio 记忆化回归。
 *
 * 背景：约 10 个组件各自调用 usePortfolio()，每个 useMemo 相互隔离，
 * 一次页面加载会把整条派生链路重复跑 8 次以上（每次都含快照重建 + FIFO + 税务 + 预测 + 指标）。
 *
 * 现以 (state, settings) 引用为键做模块级记忆化：
 * 同一次渲染里无论多少消费者，只真正计算一次；引用变化则自动失效。
 */

const DATA_DIR = path.resolve(process.cwd(), 'public/data');

function readPipelineJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf-8'));
}

/** 实际挂载 usePortfolio() 的组件数量（Dashboard 一屏即约 8 个消费者） */
const CONSUMER_COUNT = 20;

/** 命中缓存后 20 次调用的总预算：本质是 20 次 WeakMap 查表 */
const CACHED_CALLS_BUDGET_MS = 10;

function mkSettings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    baseCurrency: 'CNY',
    displayCurrency: 'CNY',
    colorScheme: 'CN',
    w8benFilled: false,
    fxNeutralMode: false,
    notificationChannels: {},
    stalenessThresholdHours: 48,
    ...over,
  };
}

/** 真实数据规模的 DataState（与线上启动后的形态一致） */
function mkRealState(over: Partial<DataState> = {}): DataState {
  return {
    instruments: seedInstruments,
    transactions: seedTransactions,
    dividends: normalizeDividends(readPipelineJson('dividends.json')),
    plans: seedPlans,
    notifications: [],
    prices: normalizePrices(readPipelineJson('prices.json')),
    fx: normalizeFx(readPipelineJson('fx.json')),
    lastUpdated: '2026-08-05T04:13:12Z',
    sourceHealth: {},
    ...over,
  };
}

describe('derivePortfolio 记忆化（多消费者共享同一次计算）', () => {
  it('同一 (state, settings) 引用重复调用返回同一结果对象', () => {
    clearPortfolioCache();
    const state = mkRealState();
    const settings = mkSettings();

    const first = derivePortfolio(state, settings);
    const second = derivePortfolio(state, settings);

    expect(second).toBe(first);
    expect(second.positions).toBe(first.positions);
    expect(second.snapshots).toBe(first.snapshots);
  });

  it(`${CONSUMER_COUNT} 个消费者只真正计算一次（后续调用近乎零成本）`, () => {
    clearPortfolioCache();
    const state = mkRealState();
    const settings = mkSettings();

    const coldStarted = performance.now();
    const first = derivePortfolio(state, settings);
    const coldMs = performance.now() - coldStarted;

    // 计时区间内只跑 derivePortfolio 本身；断言放到区间外，
    // 避免把 expect() 的匹配器开销算进"命中缓存的成本"。
    const warmResults: PortfolioDerived[] = [];
    const warmStarted = performance.now();
    for (let i = 1; i < CONSUMER_COUNT; i++) {
      warmResults.push(derivePortfolio(state, settings));
    }
    const warmMs = performance.now() - warmStarted;

    expect(warmResults).toHaveLength(CONSUMER_COUNT - 1);
    for (const result of warmResults) {
      expect(result).toBe(first);
    }

    // eslint-disable-next-line no-console
    console.log(
      `[perf] derivePortfolio 首次 ${coldMs.toFixed(1)}ms · 其余 ${CONSUMER_COUNT - 1} 次合计 ${warmMs.toFixed(1)}ms`,
    );

    expect(warmMs).toBeLessThan(CACHED_CALLS_BUDGET_MS);
  });

  it('state 引用变化（不可变更新）后自动失效并重算', () => {
    clearPortfolioCache();
    const settings = mkSettings();
    const state = mkRealState();
    const first = derivePortfolio(state, settings);

    // 模拟 reducer 的不可变更新：新增一笔 PENDING 流水
    const nextState: DataState = {
      ...state,
      transactions: [
        ...state.transactions,
        {
          id: 'tx-new-pending',
          instrumentId: '000001.SZ',
          type: 'BUY',
          status: 'PENDING',
          date: '2026-08-05',
          quantity: 100,
          price: 11,
          amount: 1100,
          currency: 'CNY',
          fxRate: 1,
        },
      ],
    };

    const second = derivePortfolio(nextState, settings);
    expect(second).not.toBe(first);
    expect(second.pendingTxCount).toBe(first.pendingTxCount + 1);
  });

  it('settings 引用变化后自动失效并重算', () => {
    clearPortfolioCache();
    const state = mkRealState();
    const first = derivePortfolio(state, mkSettings());
    const second = derivePortfolio(state, mkSettings({ stalenessThresholdHours: 24 }));
    expect(second).not.toBe(first);
  });

  it('缓存只影响结果复用，不改变结果本身（与清缓存后重算逐字段一致）', () => {
    clearPortfolioCache();
    const state = mkRealState();
    const settings = mkSettings();

    const cached = derivePortfolio(state, settings);
    clearPortfolioCache();
    const recomputed = derivePortfolio(state, settings);

    expect(recomputed).not.toBe(cached);
    expect(recomputed.totalMarketValue).toBe(cached.totalMarketValue);
    expect(recomputed.totalCostValue).toBe(cached.totalCostValue);
    expect(recomputed.ttmDividendTotal).toBe(cached.ttmDividendTotal);
    expect(recomputed.metrics).toEqual(cached.metrics);
    expect(recomputed.breakdown).toEqual(cached.breakdown);
    expect(recomputed.snapshots).toEqual(cached.snapshots);
    expect(recomputed.positions).toEqual(cached.positions);
    expect(recomputed.todos).toEqual(cached.todos);
  });

  it('不同 state 各自独立缓存，互不串号', () => {
    clearPortfolioCache();
    const settings = mkSettings();
    const stateA = mkRealState();
    const stateB = mkRealState({ transactions: [] });

    const a1 = derivePortfolio(stateA, settings);
    const b1 = derivePortfolio(stateB, settings);
    const a2 = derivePortfolio(stateA, settings);

    expect(a2).toBe(a1);
    expect(b1).not.toBe(a1);
    expect(b1.positions).toHaveLength(0);
    expect(a1.positions.length).toBeGreaterThan(0);
  });
});

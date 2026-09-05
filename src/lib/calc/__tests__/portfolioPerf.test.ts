import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AppSettings,
  FxSnapshot,
  Instrument,
  PortfolioSnapshot,
  PriceSnapshot,
  Transaction,
} from '@/types';
import { normalizeFx, normalizePrices } from '@/data/realData';
import { seedInstruments } from '@/data/seed/instruments.seed';
import { seedTransactions } from '@/data/seed/transactions.seed';
import { buildSnapshots } from '../portfolio';
import { latestFx, rateKey } from '../fx';

/**
 * buildSnapshots 性能回归 —— 真实数据规模。
 *
 * 背景：原实现对每个 (日期, 标的) 都全量重扫一遍流水与行情，
 * 复杂度 O(日期 × 标的 × (流水 + 行情))，在真实数据下约 4.3s，
 * 叠加约 10 个组件各自重算 → 页面交互整体冻结。
 *
 * 现实现改为「单次前向遍历 + 每标的事件/价格/汇率指针」，
 * 复杂度降到 O(日期 × 标的 + 流水 + 行情 + 汇率)。
 *
 * 本文件锁两件事：
 * 1. 真实数据规模下耗时 < 100ms（性能护栏）；
 * 2. 输出与「朴素参考实现」逐字段完全一致（语义护栏）。
 */

const PERF_BUDGET_MS = 100;

/**
 * 取多轮中的最小耗时。
 *
 * vitest 并行跑多个 worker，单轮测量会被 CPU 争抢放大（实测同一份代码 5ms~42ms 抖动）。
 * 最小值反映算法真实成本，既不会被调度噪声误报，也拦得住真实回归 ——
 * 一旦退回 O(日期 × 标的 × 流水) 的量级（秒级），每一轮都会超预算。
 */
function fastestRunMs(run: () => void, rounds = 5): number {
  run(); // 预热：排除首次 JIT / 惰性去优化
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rounds; i++) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

const DATA_DIR = path.resolve(process.cwd(), 'public/data');

function readPipelineJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf-8'));
}

const settings: AppSettings = {
  baseCurrency: 'CNY',
  displayCurrency: 'CNY',
  colorScheme: 'CN',
  w8benFilled: false,
  fxNeutralMode: false,
  notificationChannels: {},
  stalenessThresholdHours: 48,
};

/** 真实管道产物（prices.json 只发布最近约 1.5 年，见下方 perfPrices 说明） */
const realPrices: PriceSnapshot[] = normalizePrices(readPipelineJson('prices.json'));
const realFx: FxSnapshot[] = normalizeFx(readPipelineJson('fx.json'));
const instruments: Instrument[] = seedInstruments;
const transactions: Transaction[] = seedTransactions;

/** 把 'YYYY-MM-DD' 的年份整体前移 n 年（日/月不变，纯字符串运算） */
function shiftYears(date: string, years: number): string {
  return `${Number(date.slice(0, 4)) - years}${date.slice(4)}`;
}

/**
 * 压测用行情：把真实序列按年份平移复制出更长的历史。
 *
 * public/data/prices.json 现在只发布最近 540 天（首屏体积治理，见
 * scripts/pipeline/config.py 的 MAX_PRICE_HISTORY_DAYS），单靠它已撑不起
 * 原来的压测规模。性能护栏不应随「发布多少历史」这个产品决策而缩水，
 * 因此在测试内把规模放大回 5000+ 行情 / 900+ 交易日。
 *
 * Args:
 *   prices: 真实行情。
 *   extraYears: 额外复制几份历史（每份整体前移 1 年）。
 *
 * Returns:
 *   按 (日期, 标的) 升序排列的放大后行情。
 */
function amplifyHistory(prices: PriceSnapshot[], extraYears: number): PriceSnapshot[] {
  const out: PriceSnapshot[] = [...prices];
  for (let year = 1; year <= extraYears; year += 1) {
    for (const snapshot of prices) {
      out.push({ ...snapshot, date: shiftYears(snapshot.date, year) });
    }
  }
  out.sort((a, b) =>
    a.date === b.date ? a.instrumentId.localeCompare(b.instrumentId) : a.date.localeCompare(b.date),
  );
  return out;
}

const perfPrices: PriceSnapshot[] = amplifyHistory(realPrices, 2);

/** 快照序列覆盖到的最后一天（避免依赖系统当天，保证用例稳定） */
const TODAY = '2026-08-05';

// ============================================================
// 朴素参考实现：逐字复刻优化前的算法，作为语义基准
// 刻意保持「每个 (日期, 标的) 全量重扫」的写法，不复用被测代码的任何私有工具
// ============================================================

function refCollectAllDates(txs: Transaction[], prices: PriceSnapshot[], today: string): string[] {
  const set = new Set<string>([today]);
  for (const t of txs) if (t.status === 'CONFIRMED') set.add(t.date);
  for (const p of prices) set.add(p.date);
  return [...set].sort();
}

function refQuantityOnDate(instrumentId: string, txs: Transaction[], date: string): number {
  let qty = 0;
  for (const tx of txs) {
    if (tx.instrumentId !== instrumentId) continue;
    if (!(tx.date <= date)) continue;
    if (tx.status !== 'CONFIRMED') continue;
    switch (tx.type) {
      case 'BUY':
      case 'DIVIDEND_REINVEST':
        qty += tx.quantity;
        break;
      case 'SELL':
        qty -= Math.abs(tx.quantity);
        break;
      case 'SPLIT':
      case 'BONUS':
      case 'TRANSFER':
      case 'FUND_SPLIT': {
        const ratio = typeof tx.meta?.ratio === 'number' ? tx.meta.ratio : 1;
        qty *= ratio;
        break;
      }
      default:
        break;
    }
  }
  return qty;
}

function refFxOn(fx: FxSnapshot[], from: string, to: string, date: string): number {
  if (from === to) return 1;
  const key = rateKey(from as never, to as never);
  let last: FxSnapshot | undefined;
  for (const snap of fx) {
    if (snap.date <= date) last = snap;
    else break;
  }
  const rate = last?.rates?.[key];
  if (typeof rate === 'number' && rate > 0) return rate;
  const inv = last?.rates?.[rateKey(to as never, from as never)];
  if (typeof inv === 'number' && inv > 0) return 1 / inv;
  return latestFx(fx, from as never, to as never);
}

function refBuildSnapshots(
  txs: Transaction[],
  instrs: Instrument[],
  prices: PriceSnapshot[],
  fx: FxSnapshot[],
  cfg: AppSettings,
  today: string,
): PortfolioSnapshot[] {
  const confirmed = txs.filter((t) => t.status === 'CONFIRMED');
  const dates = refCollectAllDates(txs, prices, today);

  const priceSeries = new Map<string, { date: string; price: number }[]>();
  for (const instr of instrs) {
    priceSeries.set(
      instr.id,
      prices
        .filter((p) => p.instrumentId === instr.id)
        .map((p) => ({ date: p.date, price: p.price }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    );
  }

  const txsByDate = new Map<string, Transaction[]>();
  for (const tx of confirmed) {
    const list = txsByDate.get(tx.date) ?? [];
    list.push(tx);
    txsByDate.set(tx.date, list);
  }

  let invested = 0;
  let dividends = 0;
  const snapshots: PortfolioSnapshot[] = [];

  for (const date of dates) {
    for (const tx of txsByDate.get(date) ?? []) {
      const fxr = tx.fxRate;
      switch (tx.type) {
        case 'BUY':
          invested += (tx.amount + (tx.fee ?? 0)) * fxr;
          break;
        case 'SELL':
          invested -= (tx.amount - (tx.fee ?? 0)) * fxr;
          break;
        case 'DIVIDEND_CASH':
          dividends += tx.amount * fxr;
          break;
        case 'TAX_WITHHELD':
          dividends -= tx.amount * fxr;
          break;
        case 'FEE':
          invested += tx.amount * fxr;
          break;
        case 'INCOME':
          dividends += tx.amount * fxr;
          break;
        default:
          break;
      }
    }

    let marketValue = 0;
    let heldCount = 0;
    let priceFound = 0;
    for (const instr of instrs) {
      const qty = refQuantityOnDate(instr.id, confirmed, date);
      if (qty <= 0) continue;
      heldCount++;
      const series = priceSeries.get(instr.id) ?? [];
      let lastPrice: number | undefined;
      for (const s of series) {
        if (s.date <= date) lastPrice = s.price;
        else break;
      }
      if (lastPrice !== undefined) {
        priceFound++;
        marketValue += qty * lastPrice * refFxOn(fx, instr.currency, cfg.baseCurrency, date);
      }
    }

    snapshots.push({
      date,
      marketValue,
      invested,
      dividends,
      isEstimated: true,
      dataCompleteness: heldCount === 0 ? 1 : priceFound / heldCount,
    });
  }

  return snapshots;
}

// ============================================================

describe('buildSnapshots · 真实数据规模性能回归', () => {
  it('压测行情已就位（5000+ 行情 / 900+ 汇率 / 7 标的）', () => {
    expect(perfPrices.length).toBeGreaterThan(5000);
    expect(realFx.length).toBeGreaterThan(900);
    expect(instruments).toHaveLength(7);
  });

  it(`真实数据规模下耗时 < ${PERF_BUDGET_MS}ms（优化前约 4300ms）`, () => {
    const snapshots = buildSnapshots(transactions, instruments, perfPrices, realFx, settings, TODAY);
    const elapsed = fastestRunMs(() => {
      buildSnapshots(transactions, instruments, perfPrices, realFx, settings, TODAY);
    });

    // eslint-disable-next-line no-console
    console.log(
      `[perf] buildSnapshots ${elapsed.toFixed(1)}ms · ${snapshots.length} 个交易日 × ${instruments.length} 标的`,
    );

    expect(snapshots.length).toBeGreaterThan(900);
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
  });

  it('复杂度对标的数呈线性：标的翻倍不会让耗时爆炸（拒绝二次方回归）', () => {
    // 同一批标的重复一份（id 相同 → 事件/行情序列共享，纯粹放大标的维度）
    const doubled = [...instruments, ...instruments];
    const elapsed = fastestRunMs(() => {
      buildSnapshots(transactions, doubled, perfPrices, realFx, settings, TODAY);
    });
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS * 2);
  });
});

describe('buildSnapshots · 语义等价（与朴素参考实现逐字段比对）', () => {
  it('真实数据全量输出与参考实现完全一致', () => {
    const actual = buildSnapshots(transactions, instruments, realPrices, realFx, settings, TODAY);
    const expected = refBuildSnapshots(
      transactions,
      instruments,
      realPrices,
      realFx,
      settings,
      TODAY,
    );

    expect(actual).toHaveLength(expected.length);
    expect(actual).toEqual(expected);
  });

  it('含公司行动（送转）与多币种的组合下仍逐字段一致', () => {
    const instrs: Instrument[] = [
      instruments.find((i) => i.id === '000001.SZ')!, // 送转演示 · CNY
      instruments.find((i) => i.id === '00700.HK')!, // HKD
      instruments.find((i) => i.id === 'AAPL')!, // USD
    ];

    const actual = buildSnapshots(transactions, instrs, realPrices, realFx, settings, TODAY);
    const expected = refBuildSnapshots(transactions, instrs, realPrices, realFx, settings, TODAY);
    expect(actual).toEqual(expected);
  });

  it('空行情 / 空汇率等退化输入下也与参考实现一致（不抛异常）', () => {
    expect(buildSnapshots(transactions, instruments, [], [], settings, TODAY)).toEqual(
      refBuildSnapshots(transactions, instruments, [], [], settings, TODAY),
    );
    expect(buildSnapshots([], instruments, realPrices, realFx, settings, TODAY)).toEqual(
      refBuildSnapshots([], instruments, realPrices, realFx, settings, TODAY),
    );
    expect(buildSnapshots(transactions, [], realPrices, realFx, settings, TODAY)).toEqual(
      refBuildSnapshots(transactions, [], realPrices, realFx, settings, TODAY),
    );
  });

  it('清仓后再建仓：持仓指针不会把中间的空仓期算错', () => {
    const instrument = instruments.find((i) => i.id === '000001.SZ')!;
    const txs: Transaction[] = [
      {
        id: 't1',
        instrumentId: instrument.id,
        type: 'BUY',
        status: 'CONFIRMED',
        date: '2024-01-10',
        quantity: 100,
        price: 10,
        amount: 1000,
        currency: 'CNY',
        fxRate: 1,
      },
      {
        id: 't2',
        instrumentId: instrument.id,
        type: 'SELL',
        status: 'CONFIRMED',
        date: '2024-06-10',
        quantity: -100,
        price: 11,
        amount: 1100,
        currency: 'CNY',
        fxRate: 1,
      },
      {
        id: 't3',
        instrumentId: instrument.id,
        type: 'BUY',
        status: 'CONFIRMED',
        date: '2025-03-10',
        quantity: 50,
        price: 12,
        amount: 600,
        currency: 'CNY',
        fxRate: 1,
      },
    ];

    const actual = buildSnapshots(txs, [instrument], perfPrices, realFx, settings, TODAY);
    const expected = refBuildSnapshots(txs, [instrument], perfPrices, realFx, settings, TODAY);
    expect(actual).toEqual(expected);

    // 空仓区间市值必须为 0，重新建仓后恢复正数（forward-fill 未把旧价格算进空仓期）
    const flat = actual.find((s) => s.date === '2024-09-02')!;
    const rebuilt = actual.find((s) => s.date === '2025-06-02')!;
    expect(flat.marketValue).toBe(0);
    expect(rebuilt.marketValue).toBeGreaterThan(0);
  });
});

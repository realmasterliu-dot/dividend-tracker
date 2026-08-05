import { describe, expect, it } from 'vitest';
import { Instrument, InvestmentPlan, Transaction } from '@/types';
import {
  downloadHoldings,
  hasPersonalSlices,
  HOLDINGS_VERSION,
  loadPersonalData,
  mergePersonalData,
  normalizeInstruments,
  normalizePersonalData,
  normalizePlans,
  normalizeTransactions,
  PersonalSlices,
} from '../personalData';
import { seedInstruments } from '../seed/instruments.seed';
import { seedPlans } from '../seed/plans.seed';
import { seedTransactions } from '../seed/transactions.seed';

/**
 * 个人数据接入层（src/data/personalData.ts）
 * - normalizePersonalData：逐切片防御式解析，整片为空回退种子
 * - loadPersonalData：holdings.json 不可用一律降级种子，不抛出
 * - mergePersonalData：localStorage overlay 叠加在基线之上
 * - downloadHoldings：导出文本可回环解析
 */

// ============ 固件 ============

const rawInstrument = {
  id: 'TEST.SZ',
  symbol: 'TEST.SZ',
  name: '测试标的',
  market: 'A_SHARE',
  currency: 'CNY',
  dividendEligible: true,
  securityType: 'COMMON',
  extraWithholdingRate: 0,
  custodyChannel: 'CN_BROKER',
  tags: ['测试'],
};

const rawTransaction = {
  id: 'tx-test-1',
  instrumentId: 'TEST.SZ',
  type: 'BUY',
  status: 'CONFIRMED',
  date: '2026-01-05',
  quantity: 100,
  price: 12.5,
  amount: 1250,
  currency: 'CNY',
  fxRate: 1,
  note: '建仓',
  source: 'MANUAL',
  meta: { planId: 'plan-test' },
};

const rawPlan = {
  id: 'plan-test',
  instrumentId: 'TEST.SZ',
  amount: 500,
  frequency: 'MONTHLY',
  executionDay: 8,
  startDate: '2026-01-08',
  holidayPolicy: 'NEXT_TRADING_DAY',
  monthEndPolicy: 'LAST_TRADING_DAY',
  autoConfirm: false,
  status: 'ACTIVE',
  nextRunDate: '2026-09-08',
};

const HOLDINGS_FILE = {
  version: 1,
  instruments: [rawInstrument],
  transactions: [rawTransaction],
  plans: [rawPlan],
};

/** 最小 fetch 桩：按文件名返回内容，可指定失败模式 */
function mkFetch(
  files: Record<string, unknown>,
  opts: { httpError?: string[]; reject?: string[]; badJson?: string[] } = {},
): typeof fetch {
  const impl = async (input: unknown): Promise<Response> => {
    const name = String(input).split('/').pop() ?? '';
    if (opts.reject?.includes(name)) throw new TypeError('Failed to fetch');
    if (opts.httpError?.includes(name)) {
      return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    }
    if (opts.badJson?.includes(name)) {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response;
    }
    if (!(name in files)) {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => files[name] } as unknown as Response;
  };
  return impl as unknown as typeof fetch;
}

// ============ 归一化 ============

describe('normalizeInstruments（防御式解析）', () => {
  it('正常项完整映射，缺省字段安全兜底', () => {
    const [full] = normalizeInstruments([rawInstrument]);
    expect(full.id).toBe('TEST.SZ');
    expect(full.market).toBe('A_SHARE');
    expect(full.currency).toBe('CNY');
    expect(full.tags).toEqual(['测试']);

    const [minimal] = normalizeInstruments([
      { id: 'A', symbol: 'A', name: 'A股', market: 'A_SHARE', currency: 'CNY' },
    ]);
    expect(minimal.dividendEligible).toBe(true);
    expect(minimal.securityType).toBe('COMMON');
    expect(minimal.extraWithholdingRate).toBe(0);
    expect(minimal.custodyChannel).toBe('CN_BROKER');
    expect(minimal.tags).toBeUndefined();
  });

  it('缺 id / symbol / name / market / currency 的单条被剔除', () => {
    const out = normalizeInstruments([
      { ...rawInstrument, id: '' },
      { ...rawInstrument, symbol: '' },
      { ...rawInstrument, name: '' },
      { ...rawInstrument, market: 'FOREX' },
      { ...rawInstrument, currency: 'JPY' },
      null,
      'garbage',
      [1, 2],
      rawInstrument,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('TEST.SZ');
  });

  it('重复 id 只保留首条；非数组 → 空数组', () => {
    expect(normalizeInstruments([rawInstrument, { ...rawInstrument, name: '重复' }])).toHaveLength(1);
    expect(normalizeInstruments(null)).toEqual([]);
    expect(normalizeInstruments({})).toEqual([]);
  });
});

describe('normalizeTransactions（防御式解析）', () => {
  it('正常项完整映射，meta / source / note 保留', () => {
    const [tx] = normalizeTransactions([rawTransaction]);
    expect(tx.id).toBe('tx-test-1');
    expect(tx.type).toBe('BUY');
    expect(tx.amount).toBe(1250);
    expect(tx.source).toBe('MANUAL');
    expect(tx.meta).toEqual({ planId: 'plan-test' });
  });

  it('amount 缺省时按 |quantity × price| 推导，status/fxRate 兜底', () => {
    const [tx] = normalizeTransactions([
      { id: 't', instrumentId: 'A', type: 'SELL', date: '2026-01-01', quantity: -30, price: 10 },
    ]);
    expect(tx.amount).toBe(300);
    expect(tx.status).toBe('CONFIRMED');
    expect(tx.fxRate).toBe(1);
    expect(tx.currency).toBe('CNY');
  });

  it('缺 id / instrumentId / type / date 的单条被剔除', () => {
    const out = normalizeTransactions([
      { ...rawTransaction, id: '' },
      { ...rawTransaction, instrumentId: '' },
      { ...rawTransaction, type: 'NOT_A_TYPE' },
      { ...rawTransaction, date: '' },
      undefined,
      rawTransaction,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('tx-test-1');
  });
});

describe('normalizePlans（防御式解析）', () => {
  it('正常项完整映射', () => {
    const [plan] = normalizePlans([rawPlan]);
    expect(plan.id).toBe('plan-test');
    expect(plan.amount).toBe(500);
    expect(plan.frequency).toBe('MONTHLY');
    expect(plan.nextRunDate).toBe('2026-09-08');
    expect(plan.monthEndPolicy).toBe('LAST_TRADING_DAY');
  });

  it('缺 id / instrumentId / amount / frequency 的单条被剔除', () => {
    const out = normalizePlans([
      { ...rawPlan, id: '' },
      { ...rawPlan, instrumentId: '' },
      { ...rawPlan, amount: 'x' },
      { ...rawPlan, frequency: 'HOURLY' },
      rawPlan,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('plan-test');
  });
});

describe('normalizePersonalData（切片全空 → 回退种子）', () => {
  it('三切片齐备时按文件内容映射，不掺入种子', () => {
    const out = normalizePersonalData(HOLDINGS_FILE);
    expect(out.instruments).toHaveLength(1);
    expect(out.transactions).toHaveLength(1);
    expect(out.plans).toHaveLength(1);
    expect(out.instruments[0].id).toBe('TEST.SZ');
  });

  it('单个切片解析后为空 → 该切片回退对应种子，其它切片不受影响', () => {
    const out = normalizePersonalData({ ...HOLDINGS_FILE, plans: [] });
    expect(out.plans.length).toBeGreaterThan(0);
    expect(out.plans).toEqual(seedPlans);
    expect(out.instruments).toHaveLength(1); // 未受牵连
  });

  it('切片全是脏数据（解析后为空）同样回退种子', () => {
    const out = normalizePersonalData({
      instruments: [{ id: '' }, 'x', null],
      transactions: HOLDINGS_FILE.transactions,
      plans: HOLDINGS_FILE.plans,
    });
    expect(out.instruments.length).toBeGreaterThan(0);
    expect(out.instruments).toEqual(seedInstruments);
  });

  it('整个文件损坏 / 非对象 → 三切片全部回退种子', () => {
    for (const raw of [null, undefined, 'garbage', [1, 2], {}]) {
      const out = normalizePersonalData(raw);
      expect(out.instruments).toEqual(seedInstruments);
      expect(out.transactions).toEqual(seedTransactions);
      expect(out.plans).toEqual(seedPlans);
    }
  });
});

describe('hasPersonalSlices（导入前的空内容校验）', () => {
  it('任一切片非空 → true', () => {
    expect(hasPersonalSlices(HOLDINGS_FILE)).toBe(true);
    expect(hasPersonalSlices({ plans: [rawPlan] })).toBe(true);
  });

  it('三切片全空 / 非对象 → false', () => {
    expect(hasPersonalSlices({ version: 1, instruments: [], transactions: [], plans: [] })).toBe(false);
    expect(hasPersonalSlices({})).toBe(false);
    expect(hasPersonalSlices(null)).toBe(false);
    expect(hasPersonalSlices('[]')).toBe(false);
  });
});

// ============ 加载 ============

describe('loadPersonalData（永不抛出，失败降级种子）', () => {
  it('成功 → source:file，内容取自 holdings.json', async () => {
    const bundle = await loadPersonalData({
      fetchImpl: mkFetch({ 'holdings.json': HOLDINGS_FILE }),
    });
    expect(bundle.source).toBe('file');
    expect(bundle.warnings).toEqual([]);
    expect(bundle.instruments).toHaveLength(1);
    expect(bundle.instruments[0].id).toBe('TEST.SZ');
    expect(bundle.transactions[0].id).toBe('tx-test-1');
    expect(bundle.plans[0].id).toBe('plan-test');
  });

  it('404 → source:seed-fallback + warning，不抛出', async () => {
    const bundle = await loadPersonalData({ fetchImpl: mkFetch({}) });
    expect(bundle.source).toBe('seed-fallback');
    expect(bundle.instruments).toEqual(seedInstruments);
    expect(bundle.transactions).toEqual(seedTransactions);
    expect(bundle.plans).toEqual(seedPlans);
    expect(bundle.warnings.some((w) => w.includes('holdings.json 加载失败') && w.includes('404'))).toBe(true);
  });

  it('HTTP 503 → 降级并记录状态码', async () => {
    const bundle = await loadPersonalData({
      fetchImpl: mkFetch({ 'holdings.json': HOLDINGS_FILE }, { httpError: ['holdings.json'] }),
    });
    expect(bundle.source).toBe('seed-fallback');
    expect(bundle.warnings.some((w) => w.includes('503'))).toBe(true);
  });

  it('网络异常（fetch reject）→ 降级，不抛出', async () => {
    const bundle = await loadPersonalData({
      fetchImpl: mkFetch({ 'holdings.json': HOLDINGS_FILE }, { reject: ['holdings.json'] }),
    });
    expect(bundle.source).toBe('seed-fallback');
    expect(bundle.warnings.some((w) => w.includes('Failed to fetch'))).toBe(true);
  });

  it('JSON 解析失败 → 降级，不抛出', async () => {
    const bundle = await loadPersonalData({
      fetchImpl: mkFetch({ 'holdings.json': HOLDINGS_FILE }, { badJson: ['holdings.json'] }),
    });
    expect(bundle.source).toBe('seed-fallback');
    expect(bundle.warnings.some((w) => w.includes('Unexpected token'))).toBe(true);
  });

  it('请求 /data/holdings.json 且带 no-cache', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const spy = (async (input: unknown, init?: RequestInit) => {
      seen.push({ url: String(input), init: init ?? {} });
      return { ok: true, status: 200, json: async () => HOLDINGS_FILE } as unknown as Response;
    }) as unknown as typeof fetch;

    await loadPersonalData({ fetchImpl: spy });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/data/holdings.json');
    expect(seen[0].init.cache).toBe('no-cache');
  });
});

// ============ 合并 ============

const baseline: PersonalSlices = {
  instruments: [normalizeInstruments([rawInstrument])[0]],
  transactions: [normalizeTransactions([rawTransaction])[0]],
  plans: [normalizePlans([rawPlan])[0]],
};

const overlayInstrument: Instrument = {
  id: 'OVERLAY',
  symbol: 'OVERLAY',
  name: '本地新增',
  market: 'US',
  currency: 'USD',
  dividendEligible: true,
  securityType: 'COMMON',
  extraWithholdingRate: 0,
  custodyChannel: 'US_BROKER',
};

const overlayTransaction: Transaction = {
  id: 'tx-overlay',
  instrumentId: 'OVERLAY',
  type: 'BUY',
  status: 'CONFIRMED',
  date: '2026-02-02',
  quantity: 10,
  price: 100,
  amount: 1000,
  currency: 'USD',
  fxRate: 7.2,
};

const overlayPlan: InvestmentPlan = {
  id: 'plan-overlay',
  instrumentId: 'OVERLAY',
  amount: 300,
  frequency: 'WEEKLY',
  executionDay: 1,
  startDate: '2026-02-02',
  holidayPolicy: 'NEXT_TRADING_DAY',
  monthEndPolicy: 'LAST_TRADING_DAY',
  autoConfirm: false,
  status: 'ACTIVE',
};

describe('mergePersonalData（localStorage overlay 叠加在基线之上）', () => {
  it('overlay 有值 → overlay 胜出', () => {
    const merged = mergePersonalData(baseline, {
      instruments: [overlayInstrument],
      transactions: [overlayTransaction],
      plans: [overlayPlan],
    });
    expect(merged.instruments).toEqual([overlayInstrument]);
    expect(merged.transactions).toEqual([overlayTransaction]);
    expect(merged.plans).toEqual([overlayPlan]);
  });

  it('逐切片判定：只覆盖 overlay 提供的切片，其余沿用基线', () => {
    const merged = mergePersonalData(baseline, { transactions: [overlayTransaction] });
    expect(merged.transactions).toEqual([overlayTransaction]);
    expect(merged.instruments).toEqual(baseline.instruments);
    expect(merged.plans).toEqual(baseline.plans);
  });

  it('overlay 空数组 → 用基线（首次挂载的空壳缓存不能洗掉基线）', () => {
    const merged = mergePersonalData(baseline, { instruments: [], transactions: [], plans: [] });
    expect(merged).toEqual(baseline);
  });

  it('overlay 为 null / undefined → 用基线', () => {
    expect(mergePersonalData(baseline, null)).toEqual(baseline);
    expect(mergePersonalData(baseline, undefined)).toEqual(baseline);
  });

  it('不修改入参（纯函数约束）', () => {
    const snapshot = JSON.stringify(baseline);
    mergePersonalData(baseline, { plans: [overlayPlan] });
    expect(JSON.stringify(baseline)).toBe(snapshot);
  });
});

// ============ 导出 ============

describe('downloadHoldings（导出文本可回环解析）', () => {
  it('产出可被 JSON.parse，且含 version 与三个数组键', () => {
    const text = downloadHoldings(baseline);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.version).toBe(HOLDINGS_VERSION);
    expect(Array.isArray(parsed.instruments)).toBe(true);
    expect(Array.isArray(parsed.transactions)).toBe(true);
    expect(Array.isArray(parsed.plans)).toBe(true);
  });

  it('导出 → 归一化回环后内容不变（可直接提交回 public/data）', () => {
    const roundTrip = normalizePersonalData(JSON.parse(downloadHoldings(baseline)));
    expect(roundTrip).toEqual(baseline);
  });

  it('种子数据导出后回环仍与种子等价（holdings.json 基线 1:1）', () => {
    const text = downloadHoldings({
      instruments: seedInstruments,
      transactions: seedTransactions,
      plans: seedPlans,
    });
    const roundTrip = normalizePersonalData(JSON.parse(text));
    expect(roundTrip.instruments).toEqual(seedInstruments);
    expect(roundTrip.plans).toEqual(seedPlans);
    expect(roundTrip.transactions).toHaveLength(seedTransactions.length);
  });
});

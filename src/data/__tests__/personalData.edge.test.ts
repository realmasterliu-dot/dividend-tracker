import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Instrument, InvestmentPlan, Transaction } from '@/types';
import {
  downloadHoldings,
  hasPersonalSlices,
  loadPersonalData,
  mergeImportedSlices,
  mergePersonalData,
  normalizeInstruments,
  normalizePersonalData,
  normalizePersonalDataDetailed,
  normalizePlans,
  normalizeTransactions,
  PersonalOverlay,
  PersonalSlices,
} from '../personalData';
import { seedInstruments } from '../seed/instruments.seed';
import { seedPlans } from '../seed/plans.seed';
import { seedTransactions } from '../seed/transactions.seed';

/**
 * 个人数据接入层 —— QA 边界/组合补充用例（personalData.test.ts 的增量，主路径不重复）
 *
 * 覆盖点：
 * - 逐切片降级的「独立性」：一片脏不能牵连另外两片
 * - mergePersonalData 的混合 overlay（空数组 / 缺键 / 非数组脏值）
 * - loadPersonalData「文件读到了但内容缺片」→ 仍是 source:'file'
 * - boot() 的合并语义（无 DOM 依赖的等价单测：load + merge 串联）
 * - 导出 → 导入 往返链路（含 hasPersonalSlices 拦截空文件）
 * - 真实 public/data/holdings.json 基线体检（零丢行 + 引用完整性）
 *
 * 说明：仓库未安装 @testing-library/react 与 jsdom（vitest 跑在 node 环境），
 * 因此不做 DataProvider 挂载级集成测试，改以「boot 合并语义等价单测」覆盖同一逻辑。
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
};

/** 最小 fetch 桩（与 realData.test.ts / personalData.test.ts 同款） */
function mkFetch(files: Record<string, unknown>): typeof fetch {
  const impl = async (input: unknown): Promise<Response> => {
    const name = String(input).split('/').pop() ?? '';
    if (!(name in files)) {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => files[name] } as unknown as Response;
  };
  return impl as unknown as typeof fetch;
}

const baseline: PersonalSlices = {
  instruments: normalizeInstruments([rawInstrument]),
  transactions: normalizeTransactions([rawTransaction]),
  plans: normalizePlans([rawPlan]),
};

const localInstrument: Instrument = {
  id: 'LOCAL',
  symbol: 'LOCAL',
  name: '本地新增',
  market: 'US',
  currency: 'USD',
  dividendEligible: true,
  securityType: 'COMMON',
  extraWithholdingRate: 0,
  custodyChannel: 'US_BROKER',
};

const localTransaction: Transaction = {
  id: 'tx-local',
  instrumentId: 'TEST.SZ',
  type: 'BUY',
  status: 'CONFIRMED',
  date: '2026-03-03',
  quantity: 5,
  price: 20,
  amount: 100,
  currency: 'CNY',
  fxRate: 1,
};

const localPlan: InvestmentPlan = {
  id: 'plan-local',
  instrumentId: 'TEST.SZ',
  amount: 100,
  frequency: 'WEEKLY',
  executionDay: 3,
  startDate: '2026-03-03',
  holidayPolicy: 'NEXT_TRADING_DAY',
  monthEndPolicy: 'LAST_TRADING_DAY',
  autoConfirm: false,
  status: 'ACTIVE',
};

// ============ 1. 逐切片降级的独立性 ============

describe('normalizePersonalData · 逐切片降级互不牵连（QA 边界）', () => {
  it('instruments 整片脏（全缺 market）→ 只有 instruments 回退种子，其余两片仍用文件内容', () => {
    const out = normalizePersonalData({
      instruments: [
        { ...rawInstrument, market: undefined },
        { ...rawInstrument, id: 'X', symbol: 'X', market: 'FOREX' },
      ],
      transactions: [rawTransaction],
      plans: [rawPlan],
    });

    expect(out.instruments).toEqual(seedInstruments); // 该片整体降级
    expect(out.transactions).toHaveLength(1); // 未被牵连
    expect(out.transactions[0].id).toBe('tx-test-1');
    expect(out.plans).toHaveLength(1);
    expect(out.plans[0].id).toBe('plan-test');
  });

  it('两片同时降级（plans 缺键 + transactions 全脏）→ 各自回退种子，instruments 保持文件内容', () => {
    const out = normalizePersonalData({
      instruments: [rawInstrument],
      transactions: [{ ...rawTransaction, type: 'NOT_A_TYPE' }, null, 'garbage'],
      // plans 键整体缺失
    });

    expect(out.instruments).toHaveLength(1);
    expect(out.instruments[0].id).toBe('TEST.SZ');
    expect(out.transactions).toEqual(seedTransactions);
    expect(out.plans).toEqual(seedPlans);
  });
});

// ============ 2. mergePersonalData 混合 overlay ============

describe('mergePersonalData · 混合 overlay 逐片各判各的（QA 边界）', () => {
  it('instruments 空数组 + transactions 非空 + plans 缺键 → 只有 transactions 用 overlay', () => {
    const merged = mergePersonalData(baseline, {
      instruments: [],
      transactions: [localTransaction],
    });

    expect(merged.instruments).toEqual(baseline.instruments); // 空数组 = 无 overlay
    expect(merged.transactions).toEqual([localTransaction]); // 非空 = overlay 胜
    expect(merged.plans).toEqual(baseline.plans); // 缺键 = 无 overlay
  });

  it('overlay 切片为非数组脏值（null / 字符串 / 对象）→ 一律视为无 overlay，基线胜出', () => {
    const dirty = {
      instruments: null,
      transactions: 'not-an-array',
      plans: { 0: localPlan },
    } as unknown as PersonalOverlay;

    expect(mergePersonalData(baseline, dirty)).toEqual(baseline);
  });
});

// ============ 3. loadPersonalData：文件可读但内容缺片 ============

describe('loadPersonalData · 文件成功读取但切片缺失（QA 边界）', () => {
  it('缺 plans 键 + transactions 为空数组 → 两片回退种子，source 仍为 file 且各带一条回退 warning', async () => {
    const bundle = await loadPersonalData({
      fetchImpl: mkFetch({
        'holdings.json': { version: 1, instruments: [rawInstrument], transactions: [] },
      }),
    });

    expect(bundle.source).toBe('file'); // 文件本身没问题，只是内容缺片
    expect(bundle.instruments).toHaveLength(1);
    expect(bundle.instruments[0].id).toBe('TEST.SZ');
    expect(bundle.transactions).toEqual(seedTransactions);
    expect(bundle.plans).toEqual(seedPlans);

    // ★静默回退是误导：回退的两片必须各有一条 warning，instruments 正常则不报
    expect(bundle.warnings).toHaveLength(2);
    expect(bundle.warnings.some((w) => w.includes('transactions') && w.includes('回退内置种子'))).toBe(true);
    expect(bundle.warnings.some((w) => w.includes('plans') && w.includes('回退内置种子'))).toBe(true);
    expect(bundle.warnings.some((w) => w.includes('instruments'))).toBe(false);
  });

  it('文件是合法 JSON 但顶层不是对象（[]）→ 三片全部回退种子 + 三条 warning，仍报 source:file', async () => {
    const bundle = await loadPersonalData({ fetchImpl: mkFetch({ 'holdings.json': [] }) });

    expect(bundle.source).toBe('file');
    expect(bundle.instruments).toEqual(seedInstruments);
    expect(bundle.transactions).toEqual(seedTransactions);
    expect(bundle.plans).toEqual(seedPlans);
    expect(bundle.warnings).toHaveLength(3);
    expect(bundle.warnings.every((w) => w.includes('已回退内置种子'))).toBe(true);
  });

  it('generatedAt 透传：文件带则原样带出，缺失/非字符串则为 undefined', async () => {
    const withTs = await loadPersonalData({
      fetchImpl: mkFetch({
        'holdings.json': {
          version: 1,
          generatedAt: '2026-05-01T00:00:00.000Z',
          instruments: [rawInstrument],
          transactions: [rawTransaction],
          plans: [rawPlan],
        },
      }),
    });
    expect(withTs.generatedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(withTs.warnings).toEqual([]);

    const without = await loadPersonalData({
      fetchImpl: mkFetch({
        'holdings.json': { version: 1, generatedAt: 42, instruments: [rawInstrument], transactions: [rawTransaction], plans: [rawPlan] },
      }),
    });
    expect(without.generatedAt).toBeUndefined();

    // 降级路径不伪造时间戳
    const fallback = await loadPersonalData({ fetchImpl: mkFetch({}) });
    expect(fallback.source).toBe('seed-fallback');
    expect(fallback.generatedAt).toBeUndefined();
  });
});

// ============ 3b. normalizePersonalDataDetailed：逐片回退告警 ============

describe('normalizePersonalDataDetailed · 回退种子必须留痕（QA P3-1）', () => {
  const fullFile = {
    version: 1,
    instruments: [rawInstrument],
    transactions: [rawTransaction],
    plans: [rawPlan],
  };

  it('三片齐备 → slices 取文件内容且 warnings 为空', () => {
    const { slices, warnings } = normalizePersonalDataDetailed(fullFile);
    expect(warnings).toEqual([]);
    expect(slices.instruments.map((i) => i.id)).toEqual(['TEST.SZ']);
    expect(slices.transactions.map((t) => t.id)).toEqual(['tx-test-1']);
    expect(slices.plans.map((p) => p.id)).toEqual(['plan-test']);
  });

  it('单片全脏 → 只有该片回退且只报一条 warning，文案点名切片', () => {
    const { slices, warnings } = normalizePersonalDataDetailed({
      ...fullFile,
      instruments: [{ id: '' }, 'x', null],
    });
    expect(slices.instruments).toEqual(seedInstruments);
    expect(slices.transactions).toHaveLength(1); // 未被牵连
    expect(warnings).toEqual(['holdings.json 中 instruments 为空/缺失，已回退内置种子']);
  });

  it('整个文件非对象 / 空对象 → 三条 warning，顺序为 instruments → transactions → plans', () => {
    for (const raw of [null, undefined, 'garbage', {}]) {
      const { warnings } = normalizePersonalDataDetailed(raw);
      expect(warnings).toHaveLength(3);
      expect(warnings[0]).toContain('instruments');
      expect(warnings[1]).toContain('transactions');
      expect(warnings[2]).toContain('plans');
    }
  });

  it('normalizePersonalData 是它的丢弃告警版：slices 完全一致（签名不变）', () => {
    const raw = { ...fullFile, plans: [] };
    expect(normalizePersonalData(raw)).toEqual(normalizePersonalDataDetailed(raw).slices);
  });
});

// ============ 3c. mergeImportedSlices：导入不得洗掉未提供的切片 ============

describe('mergeImportedSlices · 导入缺片保留当前数据（QA P3-2）', () => {
  const current: PersonalSlices = {
    instruments: [localInstrument],
    transactions: [localTransaction],
    plans: [localPlan],
  };

  it('只含 instruments 的文件 → 覆盖 instruments，流水与计划原样保留（不回退种子）', () => {
    const { slices, warnings } = mergeImportedSlices(current, {
      version: 1,
      instruments: [rawInstrument],
    });

    expect(slices.instruments.map((i) => i.id)).toEqual(['TEST.SZ']); // 文件胜出
    expect(slices.transactions).toEqual(current.transactions); // ★不是 seedTransactions
    expect(slices.plans).toEqual(current.plans);
    expect(slices.transactions).not.toEqual(seedTransactions);
    expect(slices.plans).not.toEqual(seedPlans);
    expect(warnings).toHaveLength(2);
    expect(warnings.some((w) => w.includes('transactions') && w.includes('已保留当前数据'))).toBe(true);
    expect(warnings.some((w) => w.includes('plans') && w.includes('已保留当前数据'))).toBe(true);
  });

  it('三片齐备的文件 → 全量替换当前数据，无 warning', () => {
    const { slices, warnings } = mergeImportedSlices(current, {
      version: 1,
      instruments: [rawInstrument],
      transactions: [rawTransaction],
      plans: [rawPlan],
    });

    expect(warnings).toEqual([]);
    expect(slices.instruments.map((i) => i.id)).toEqual(['TEST.SZ']);
    expect(slices.transactions.map((t) => t.id)).toEqual(['tx-test-1']);
    expect(slices.plans.map((p) => p.id)).toEqual(['plan-test']);
  });

  it('切片为空数组 / 全脏行 → 同样按缺失处理，保留当前数据', () => {
    const { slices, warnings } = mergeImportedSlices(current, {
      instruments: [rawInstrument],
      transactions: [],
      plans: [{ ...rawPlan, frequency: 'HOURLY' }],
    });

    expect(slices.transactions).toEqual(current.transactions);
    expect(slices.plans).toEqual(current.plans);
    expect(warnings).toHaveLength(2);
  });

  it('不修改入参，且文件非对象时三片全部保留当前数据', () => {
    const snapshot = JSON.stringify(current);
    const { slices, warnings } = mergeImportedSlices(current, 'garbage');
    expect(slices).toEqual(current);
    expect(warnings).toHaveLength(3);
    expect(JSON.stringify(current)).toBe(snapshot);
  });
});

// ============ 4. boot() 合并语义（无 DOM 的等价单测） ============

describe('boot 合并语义 · loadPersonalData + mergePersonalData 串联（QA 组合）', () => {
  const fileBundle = {
    version: 1,
    instruments: [rawInstrument],
    transactions: [rawTransaction],
    plans: [rawPlan],
  };

  it('首次访问（localStorage 快照为 null）→ 完全采用 holdings.json 基线', async () => {
    const personal = await loadPersonalData({ fetchImpl: mkFetch({ 'holdings.json': fileBundle }) });
    const merged = mergePersonalData(personal, null);

    expect(merged.instruments.map((i) => i.id)).toEqual(['TEST.SZ']);
    expect(merged.transactions.map((t) => t.id)).toEqual(['tx-test-1']);
    expect(merged.plans.map((p) => p.id)).toEqual(['plan-test']);
  });

  it('空壳 localStorage 快照（三切片皆空数组）不得洗掉 holdings.json 基线', async () => {
    const personal = await loadPersonalData({ fetchImpl: mkFetch({ 'holdings.json': fileBundle }) });
    const merged = mergePersonalData(personal, { instruments: [], transactions: [], plans: [] });

    expect(merged.instruments.map((i) => i.id)).toEqual(['TEST.SZ']);
    expect(merged.transactions.map((t) => t.id)).toEqual(['tx-test-1']);
    expect(merged.plans.map((p) => p.id)).toEqual(['plan-test']);
  });

  it('回访且本地有编辑 → 只有被编辑的切片用 overlay，未编辑切片仍取服务器基线', async () => {
    const personal = await loadPersonalData({ fetchImpl: mkFetch({ 'holdings.json': fileBundle }) });
    const merged = mergePersonalData(personal, {
      instruments: [localInstrument],
      transactions: [],
    });

    expect(merged.instruments).toEqual([localInstrument]); // 本地编辑保住
    expect(merged.transactions.map((t) => t.id)).toEqual(['tx-test-1']); // 服务器基线
    expect(merged.plans.map((p) => p.id)).toEqual(['plan-test']);
  });

  it('holdings.json 404 时 boot 仍能产出可用数据（种子兜底 + 本地编辑叠加）', async () => {
    const personal = await loadPersonalData({ fetchImpl: mkFetch({}) });
    const merged = mergePersonalData(personal, { transactions: [localTransaction] });

    expect(personal.source).toBe('seed-fallback');
    expect(merged.instruments).toEqual(seedInstruments);
    expect(merged.transactions).toEqual([localTransaction]);
    expect(merged.plans).toEqual(seedPlans);
  });
});

// ============ 5. 导出 → 导入 往返 ============

describe('downloadHoldings ↔ importPersonalData 往返（QA 组合）', () => {
  it('导出文本可通过 hasPersonalSlices 校验，归一化后三切片数量与 id 与原 state 一致', () => {
    const state: PersonalSlices = {
      instruments: seedInstruments,
      transactions: seedTransactions,
      plans: seedPlans,
    };

    const raw: unknown = JSON.parse(downloadHoldings(state));
    expect(hasPersonalSlices(raw)).toBe(true);

    const roundTrip = normalizePersonalData(raw);
    expect(roundTrip.instruments).toHaveLength(state.instruments.length);
    expect(roundTrip.transactions).toHaveLength(state.transactions.length);
    expect(roundTrip.plans).toHaveLength(state.plans.length);
    expect(roundTrip.instruments.map((i) => i.id)).toEqual(state.instruments.map((i) => i.id));
    expect(roundTrip.transactions.map((t) => t.id)).toEqual(state.transactions.map((t) => t.id));
    expect(roundTrip.plans.map((p) => p.id)).toEqual(state.plans.map((p) => p.id));
  });

  it('空 state 导出的文件再导入会被 hasPersonalSlices 拦下（不会把现有数据洗空）', () => {
    const text = downloadHoldings({ instruments: [], transactions: [], plans: [] });
    expect(hasPersonalSlices(JSON.parse(text))).toBe(false);
  });
});

describe('hasPersonalSlices · 导入校验边界（QA 边界）', () => {
  it('只带一个空数组切片 → false；只带一个非空切片 → true', () => {
    expect(hasPersonalSlices({ instruments: [] })).toBe(false);
    expect(hasPersonalSlices({ version: 1, instruments: [rawInstrument] })).toBe(true);
  });

  it('切片存在但不是数组（对象 / 字符串 / 数字）→ false', () => {
    expect(hasPersonalSlices({ instruments: { 0: rawInstrument } })).toBe(false);
    expect(hasPersonalSlices({ transactions: 'x', plans: 3 })).toBe(false);
  });

  it('★导入只含 instruments 的文件：门禁放行，且走 mergeImportedSlices 保住当前流水/计划', () => {
    const raw = { version: 1, instruments: [rawInstrument] };
    expect(hasPersonalSlices(raw)).toBe(true);

    // 冷启动基线语义（normalizePersonalData）仍是回退种子 —— 这是给 holdings.json 用的
    const asBaseline = normalizePersonalData(raw);
    expect(asBaseline.transactions).toEqual(seedTransactions);

    // 导入语义（DataContext.importPersonalData 实际调用的）→ 保留当前数据，不丢流水
    const current: PersonalSlices = {
      instruments: [localInstrument],
      transactions: [localTransaction],
      plans: [localPlan],
    };
    const { slices } = mergeImportedSlices(current, raw);
    expect(slices.instruments).toHaveLength(1);
    expect(slices.transactions).toEqual([localTransaction]);
    expect(slices.plans).toEqual([localPlan]);
  });
});

// ============ 6. 真实基线文件体检 ============

describe('public/data/holdings.json 基线体检（QA 数据回归）', () => {
  const raw: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../public/data/holdings.json', import.meta.url)), 'utf-8'),
  ) as unknown;

  it('可通过导入校验，且归一化零丢行（任何脏行都会在此暴露）', () => {
    expect(hasPersonalSlices(raw)).toBe(true);

    const file = raw as Record<string, unknown[]>;
    const out = normalizePersonalData(raw);
    expect(out.instruments).toHaveLength(file.instruments.length);
    expect(out.transactions).toHaveLength(file.transactions.length);
    expect(out.plans).toHaveLength(file.plans.length);
    // 未触发任何切片的种子兜底（兜底会原样返回 seed 数组引用）
    expect(out.instruments).not.toBe(seedInstruments);
    expect(out.transactions).not.toBe(seedTransactions);
    expect(out.plans).not.toBe(seedPlans);
  });

  it('流水与定投计划的 instrumentId 均可解析到 instruments（无孤儿引用）', () => {
    const out = normalizePersonalData(raw);
    const ids = new Set(out.instruments.map((i) => i.id));
    expect(out.transactions.filter((t) => !ids.has(t.instrumentId)).map((t) => t.id)).toEqual([]);
    expect(out.plans.filter((p) => !ids.has(p.instrumentId)).map((p) => p.id)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  AppSettings,
  DataState,
  DividendEvent,
  FxSnapshot,
  Instrument,
  InvestmentPlan,
  Notification,
  PriceSnapshot,
  Transaction,
} from '@/types';
import { todayISO } from '@/lib/clock';
import {
  applyMarketData,
  dataUrl,
  loadMarketData,
  MarketDataBundle,
  mergeDividends,
  normalizeDividends,
  normalizeFx,
  normalizeMeta,
  normalizePrices,
  normalizeSourceHealth,
  stripUserEdits,
} from '../realData';

/**
 * 真实数据接入层（src/data/realData.ts）
 * - normalize*：管道产物损坏也不能白屏
 * - loadMarketData：Promise.allSettled 单文件降级
 * - applyMarketData：覆盖市场切片 / 保留个人数据 / 重算通知
 */

const TODAY = todayISO();

// ============ 归一化 ============

describe('normalizePrices（防御式解析 + 日期升序）', () => {
  it('正常项完整映射，缺省字段兜底', () => {
    const out = normalizePrices([
      { instrumentId: 'AAPL', date: '2026-08-04', price: 210.5, currency: 'USD', fxRate: 7.2, source: 'yf' },
      { instrumentId: '110011', date: '2026-08-04', price: 3.12, navDate: '2026-08-03' },
    ]);
    expect(out).toHaveLength(2);
    const fund = out.find((p) => p.instrumentId === '110011')!;
    expect(fund.currency).toBe('CNY'); // 币种缺失 → 兜底 CNY
    expect(fund.fxRate).toBe(1);
    expect(fund.source).toBe('pipeline');
    expect(fund.navDate).toBe('2026-08-03');
  });

  it('剔除缺 instrumentId / date / 非有限 price 的脏项', () => {
    const out = normalizePrices([
      { instrumentId: '', date: '2026-08-04', price: 1 },
      { instrumentId: 'A', date: '', price: 1 },
      { instrumentId: 'A', date: '2026-08-04', price: 'abc' },
      { instrumentId: 'A', date: '2026-08-04', price: Number.NaN },
      { instrumentId: 'A', date: '2026-08-04' },
      null,
      'garbage',
      [1, 2],
      { instrumentId: 'A', date: '2026-08-04', price: 9 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].price).toBe(9);
  });

  it('按日期升序排序（forward-fill / 快照重建依赖有序）', () => {
    const out = normalizePrices([
      { instrumentId: 'A', date: '2026-08-04', price: 3 },
      { instrumentId: 'A', date: '2026-01-01', price: 1 },
      { instrumentId: 'A', date: '2026-05-01', price: 2 },
    ]);
    expect(out.map((p) => p.date)).toEqual(['2026-01-01', '2026-05-01', '2026-08-04']);
  });

  it('非数组输入（null / 对象 / 字符串）→ 空数组', () => {
    expect(normalizePrices(null)).toEqual([]);
    expect(normalizePrices({})).toEqual([]);
    expect(normalizePrices('x')).toEqual([]);
    expect(normalizePrices(undefined)).toEqual([]);
  });
});

describe('normalizeFx（升序 + 剔除非法汇率）', () => {
  it('按日期升序，供 fxOn forward-fill 与 latestFx 取末位', () => {
    const out = normalizeFx([
      { date: '2026-08-04', rates: { USDCNY: 7.1 } },
      { date: '2026-01-01', rates: { USDCNY: 6.9 } },
    ]);
    expect(out.map((f) => f.date)).toEqual(['2026-01-01', '2026-08-04']);
    expect(out[out.length - 1].rates.USDCNY).toBe(7.1);
  });

  it('剔除 0 / 负数 / 非数值 汇率，保留合法项', () => {
    const out = normalizeFx([
      { date: '2026-08-04', rates: { USDCNY: 7.2, HKDCNY: 0, EURCNY: -1, JPYCNY: 'x', GBPCNY: null } },
    ]);
    expect(out[0].rates).toEqual({ USDCNY: 7.2 });
  });

  it('缺 date 或 rates 不是对象 → 跳过；非数组 → 空数组', () => {
    expect(normalizeFx([{ rates: { USDCNY: 7 } }, { date: '2026-08-04' }, { date: '2026-08-04', rates: [] }])).toEqual(
      [],
    );
    expect(normalizeFx(null)).toEqual([]);
  });
});

describe('normalizeDividends（事实字段搬运 + 派生字段归零）', () => {
  const raw = [
    {
      id: 'div-1',
      instrumentId: '000001.SZ',
      status: 'PAID',
      recordDate: '2026-05-20',
      exDate: '2026-05-21',
      payDate: '2026-06-30',
      payDateEstimated: true,
      perShareAmount: 0.3,
      currency: 'CNY',
      quantityAtRecord: 999,
      grossAmount: 888,
      netAmount: 777,
      dividendForm: 'CASH_SCRIP',
      sourceKey: 'em:fhps:000001:2026',
      isEstimate: false,
    },
  ];

  it('派生金额一律归零占位，交由 TaxEngine 按持仓推导', () => {
    const [d] = normalizeDividends(raw);
    expect(d.quantityAtRecord).toBe(0);
    expect(d.grossAmount).toBe(0);
    expect(d.taxRateApplied).toBe(0);
    expect(d.taxWithheld).toBe(0);
    expect(d.contingentTax).toBe(0);
    expect(d.netAmount).toBe(0);
    expect(d.taxBracket).toBe('NONE');
  });

  it('事实字段完整搬运', () => {
    const [d] = normalizeDividends(raw);
    expect(d.id).toBe('div-1');
    expect(d.instrumentId).toBe('000001.SZ');
    expect(d.status).toBe('PAID');
    expect(d.recordDate).toBe('2026-05-20');
    expect(d.payDateEstimated).toBe(true);
    expect(d.perShareAmount).toBe(0.3);
    expect(d.dividendForm).toBe('CASH_SCRIP');
    expect(d.sourceKey).toBe('em:fhps:000001:2026');
  });

  it('缺 id 时用 sourceKey 派生；两者都缺 → 丢弃', () => {
    const out = normalizeDividends([
      { instrumentId: 'A', sourceKey: 'k1', perShareAmount: 1 },
      { instrumentId: 'A', perShareAmount: 1 },
      { sourceKey: 'k2', perShareAmount: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('div-k1');
  });

  it('非法枚举值兜底：status → PAID，dividendForm → CASH，currency → CNY', () => {
    const [d] = normalizeDividends([
      { id: 'x', instrumentId: 'A', status: 'WHATEVER', dividendForm: 'BOGUS', currency: 'JPY' },
    ]);
    expect(d.status).toBe('PAID');
    expect(d.dividendForm).toBe('CASH');
    expect(d.currency).toBe('CNY');
    expect(d.perShareAmount).toBe(0);
  });

  it('按 派息日 ?? 除息日 ?? 登记日 升序排序', () => {
    const out = normalizeDividends([
      { id: 'c', instrumentId: 'A', payDate: '2026-09-01' },
      { id: 'a', instrumentId: 'A', payDate: '2026-01-01' },
      { id: 'b', instrumentId: 'A', exDate: '2026-05-01' },
    ]);
    expect(out.map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('非数组 → 空数组', () => {
    expect(normalizeDividends(null)).toEqual([]);
    expect(normalizeDividends({ a: 1 })).toEqual([]);
  });
});

describe('normalizeSourceHealth / normalizeMeta（防御）', () => {
  it('sourceHealth 正常映射，非法 status 兜底 YELLOW', () => {
    const out = normalizeSourceHealth({
      'akshare.a': { lastSuccess: '2026-08-05T04:12:58Z', consecutiveFailures: 0, status: 'GREEN' },
      'akshare.b': { status: 'PURPLE' },
      'bad-entry': 'not-an-object',
    });
    expect(out['akshare.a'].status).toBe('GREEN');
    expect(out['akshare.a'].consecutiveFailures).toBe(0);
    expect(out['akshare.b'].status).toBe('YELLOW');
    expect(out['akshare.b'].lastSuccess).toBe('');
    expect(out['bad-entry']).toBeUndefined();
  });

  it('sourceHealth 非对象 → 空对象', () => {
    expect(normalizeSourceHealth(null)).toEqual({});
    expect(normalizeSourceHealth([1, 2])).toEqual({});
  });

  it('meta 正常映射，warnings / categories 过滤非字符串', () => {
    const meta = normalizeMeta({
      generatedAt: '2026-08-05T04:13:12Z',
      pipelineVersion: '1.0.0',
      instrumentCount: 7,
      warnings: ['熔断：binance.klines', 42, null, ''],
      durationSeconds: 16.85,
      categories: ['prices', 'dividends', 'fx'],
    })!;
    expect(meta.generatedAt).toBe('2026-08-05T04:13:12Z');
    expect(meta.instrumentCount).toBe(7);
    expect(meta.warnings).toEqual(['熔断：binance.klines']);
    expect(meta.categories).toEqual(['prices', 'dividends', 'fx']);
  });

  it('meta 非对象 → null；字段缺失 → 安全默认值', () => {
    expect(normalizeMeta(null)).toBeNull();
    expect(normalizeMeta('x')).toBeNull();
    const empty = normalizeMeta({})!;
    expect(empty.generatedAt).toBe('');
    expect(empty.warnings).toEqual([]);
    expect(empty.durationSeconds).toBe(0);
  });
});

// ============ 加载 ============

describe('dataUrl（public/ 映射到站点根 /data/*）', () => {
  it('生成 /data/<file> 且不出现双斜杠', () => {
    expect(dataUrl('prices.json')).toBe('/data/prices.json');
    expect(dataUrl('meta.json')).toBe('/data/meta.json');
    expect(dataUrl('fx.json').includes('//')).toBe(false);
  });
});

const PIPELINE_FILES = {
  'prices.json': [{ instrumentId: 'A', date: '2026-08-04', price: 10 }],
  'dividends.json': [{ id: 'd1', instrumentId: 'A', perShareAmount: 0.5, payDate: '2026-06-30' }],
  'fx.json': [{ date: '2026-08-04', rates: { USDCNY: 7.2 } }],
  'source_health.json': { 'akshare.a': { lastSuccess: '2026-08-05T04:00:00Z', consecutiveFailures: 0, status: 'GREEN' } },
  'meta.json': { generatedAt: '2026-08-05T04:13:12Z', pipelineVersion: '1.0.0', instrumentCount: 1, warnings: [] },
} as Record<string, unknown>;

/** 最小 fetch 桩：按文件名返回管道产物，可指定失败集合 */
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

describe('loadMarketData（Promise.allSettled 单文件降级）', () => {
  it('全部成功 → 五个切片齐备，lastUpdated 取 meta.generatedAt', async () => {
    const bundle = await loadMarketData({ fetchImpl: mkFetch(PIPELINE_FILES) });
    expect(bundle.prices).toHaveLength(1);
    expect(bundle.dividends).toHaveLength(1);
    expect(bundle.fx).toHaveLength(1);
    expect(Object.keys(bundle.sourceHealth)).toEqual(['akshare.a']);
    expect(bundle.meta?.pipelineVersion).toBe('1.0.0');
    expect(bundle.lastUpdated).toBe('2026-08-05T04:13:12Z');
    expect(bundle.warnings).toEqual([]);
  });

  it('单文件 HTTP 失败不阻断整体：该切片降级为空并记录 warning', async () => {
    const bundle = await loadMarketData({
      fetchImpl: mkFetch(PIPELINE_FILES, { httpError: ['dividends.json'] }),
    });
    expect(bundle.prices).toHaveLength(1); // 其它切片不受影响
    expect(bundle.fx).toHaveLength(1);
    expect(bundle.dividends).toEqual([]);
    expect(bundle.warnings.some((w) => w.includes('dividends.json') && w.includes('503'))).toBe(true);
  });

  it('网络异常（fetch reject）同样降级，不抛出', async () => {
    const bundle = await loadMarketData({
      fetchImpl: mkFetch(PIPELINE_FILES, { reject: ['fx.json'] }),
    });
    expect(bundle.fx).toEqual([]);
    expect(bundle.warnings.some((w) => w.includes('fx.json') && w.includes('Failed to fetch'))).toBe(true);
    expect(bundle.warnings.some((w) => w.includes('汇率数据为空'))).toBe(true);
  });

  it('JSON 解析异常降级为空切片', async () => {
    const bundle = await loadMarketData({
      fetchImpl: mkFetch(PIPELINE_FILES, { badJson: ['prices.json'] }),
    });
    expect(bundle.prices).toEqual([]);
    expect(bundle.warnings.some((w) => w.includes('prices.json'))).toBe(true);
    expect(bundle.warnings.some((w) => w.includes('行情数据为空'))).toBe(true);
  });

  it('全部文件失败 → 空 bundle + 逐文件 warning，仍不抛出', async () => {
    const bundle = await loadMarketData({ fetchImpl: mkFetch({}) });
    expect(bundle.prices).toEqual([]);
    expect(bundle.dividends).toEqual([]);
    expect(bundle.fx).toEqual([]);
    expect(bundle.sourceHealth).toEqual({});
    expect(bundle.meta).toBeNull();
    for (const file of ['prices.json', 'dividends.json', 'fx.json', 'source_health.json', 'meta.json']) {
      expect(bundle.warnings.some((w) => w.startsWith(file))).toBe(true);
    }
  });

  it('管道自带 warnings 透传（带「管道告警」前缀）', async () => {
    const files = {
      ...PIPELINE_FILES,
      'meta.json': {
        generatedAt: '2026-08-05T04:13:12Z',
        warnings: ['以下数据源已连续失败并进入熔断：binance.klines'],
      },
    };
    const bundle = await loadMarketData({ fetchImpl: mkFetch(files) });
    expect(bundle.warnings.some((w) => w.startsWith('管道告警：') && w.includes('binance.klines'))).toBe(true);
  });

  it('缺 meta 时 lastUpdated 回退到 sourceHealth 最新成功时间', async () => {
    const files = { ...PIPELINE_FILES };
    delete files['meta.json'];
    const bundle = await loadMarketData({ fetchImpl: mkFetch(files) });
    expect(bundle.lastUpdated).toBe('2026-08-05T04:00:00Z');
  });

  it('meta 与 sourceHealth 均缺失时回退到最新行情日期', async () => {
    const files = { 'prices.json': PIPELINE_FILES['prices.json'] };
    const bundle = await loadMarketData({ fetchImpl: mkFetch(files) });
    expect(bundle.lastUpdated).toBe('2026-08-04T00:00:00Z');
  });

  it('默认请求带 default 缓存提示，由实际托管响应头决定是否命中', async () => {
    const seen: RequestInit[] = [];
    const spy = (async (input: unknown, init?: RequestInit) => {
      seen.push(init ?? {});
      const name = String(input).split('/').pop() ?? '';
      return { ok: true, status: 200, json: async () => PIPELINE_FILES[name] ?? null } as unknown as Response;
    }) as unknown as typeof fetch;

    await loadMarketData({ fetchImpl: spy });
    expect(seen).toHaveLength(5);
    expect(seen.every((i) => i.cache === 'default')).toBe(true);
  });

  it('显式传入 no-cache（手动刷新路径）→ 全部请求绕过浏览器缓存强制回源', async () => {
    const seen: RequestInit[] = [];
    const spy = (async (input: unknown, init?: RequestInit) => {
      seen.push(init ?? {});
      const name = String(input).split('/').pop() ?? '';
      return { ok: true, status: 200, json: async () => PIPELINE_FILES[name] ?? null } as unknown as Response;
    }) as unknown as typeof fetch;

    await loadMarketData({ fetchImpl: spy, cache: 'no-cache' });
    expect(seen).toHaveLength(5);
    expect(seen.every((i) => i.cache === 'no-cache')).toBe(true);
  });

  it('单个请求长期不返回时按超时降级，不让启动无限等待', async () => {
    const never = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const startedAt = Date.now();
    const bundle = await loadMarketData({ fetchImpl: never, timeoutMs: 10 });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(bundle.warnings.filter((warning) => warning.includes('请求超时'))).toHaveLength(5);
    expect(bundle.prices).toEqual([]);
  });
});

// ============ 合并 ============

function mkDiv(over: Partial<DividendEvent> & { id: string }): DividendEvent {
  return {
    instrumentId: '000001.SZ',
    status: 'PAID',
    recordDate: '2026-05-20',
    exDate: '2026-05-21',
    payDate: '2026-06-30',
    payDateEstimated: false,
    perShareAmount: 0.5,
    currency: 'CNY',
    quantityAtRecord: 0,
    grossAmount: 0,
    taxRateApplied: 0,
    taxWithheld: 0,
    contingentTax: 0,
    netAmount: 0,
    taxBracket: 'NONE',
    dividendForm: 'CASH',
    manual: false,
    sourceKey: 'sk',
    ...over,
  } as DividendEvent;
}

describe('mergeDividends（管道为事实来源 + 保留用户手工订正）', () => {
  it('保留 actualReceived 并将状态提升为 RECONCILED', () => {
    const existing = [mkDiv({ id: 'd1', actualReceived: 480, status: 'RECONCILED' })];
    const incoming = [mkDiv({ id: 'd1', status: 'PAID', perShareAmount: 0.6 })];
    const [merged] = mergeDividends(existing, incoming);

    expect(merged.perShareAmount).toBe(0.6); // 事实字段以管道为准
    expect(merged.actualReceived).toBe(480); // 用户订正跨刷新保留
    expect(merged.status).toBe('RECONCILED');
  });

  it('保留 taxWithheldOverride', () => {
    const existing = [mkDiv({ id: 'd1', taxWithheldOverride: 12.5 })];
    const incoming = [mkDiv({ id: 'd1' })];
    expect(mergeDividends(existing, incoming)[0].taxWithheldOverride).toBe(12.5);
  });

  it('用户手工录入且管道未覆盖的事件不丢失', () => {
    const existing = [mkDiv({ id: 'manual-1', manual: true })];
    const incoming = [mkDiv({ id: 'd1' })];
    const merged = mergeDividends(existing, incoming);
    expect(merged.map((d) => d.id).sort()).toEqual(['d1', 'manual-1']);
  });

  it('管道已收录的手工事件不重复（以管道版本为准）', () => {
    const existing = [mkDiv({ id: 'd1', manual: true, actualReceived: 100 })];
    const incoming = [mkDiv({ id: 'd1', manual: false })];
    const merged = mergeDividends(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].manual).toBe(false);
    expect(merged[0].actualReceived).toBe(100);
  });

  it('管道不再提供的非手工事件被淘汰（不残留脏数据）', () => {
    const existing = [mkDiv({ id: 'stale-pipeline' })];
    const incoming = [mkDiv({ id: 'd1' })];
    expect(mergeDividends(existing, incoming).map((d) => d.id)).toEqual(['d1']);
  });

  it('不修改入参数组', () => {
    const existing = [mkDiv({ id: 'd1', actualReceived: 1 })];
    const incoming = [mkDiv({ id: 'd1' })];
    const snapshot = JSON.stringify({ existing, incoming });
    mergeDividends(existing, incoming);
    expect(JSON.stringify({ existing, incoming })).toBe(snapshot);
  });
});

describe('stripUserEdits（重置回管道原始事实）', () => {
  it('清除 actualReceived / taxWithheldOverride / deviationPct，RECONCILED 回落 PAID', () => {
    const [out] = stripUserEdits([
      mkDiv({ id: 'd1', status: 'RECONCILED', actualReceived: 480, taxWithheldOverride: 5, deviationPct: -0.04 }),
    ]);
    expect(out.actualReceived).toBeUndefined();
    expect(out.taxWithheldOverride).toBeUndefined();
    expect(out.deviationPct).toBeUndefined();
    expect(out.status).toBe('PAID');
  });

  it('剔除用户手工录入的事件，保留管道事件', () => {
    const out = stripUserEdits([mkDiv({ id: 'p1' }), mkDiv({ id: 'm1', manual: true })]);
    expect(out.map((d) => d.id)).toEqual(['p1']);
  });

  it('非 RECONCILED 状态不被改写', () => {
    const [out] = stripUserEdits([mkDiv({ id: 'd1', status: 'DECLARED' })]);
    expect(out.status).toBe('DECLARED');
  });
});

// ============ 合入 DataState ============

const settings: AppSettings = {
  baseCurrency: 'CNY',
  displayCurrency: 'CNY',
  colorScheme: 'CN',
  w8benFilled: false,
  fxNeutralMode: false,
  notificationChannels: {},
  stalenessThresholdHours: 48,
};

const instrument: Instrument = {
  id: '000001.SZ',
  symbol: '000001.SZ',
  name: '平安银行',
  market: 'A_SHARE',
  currency: 'CNY',
  dividendEligible: true,
  securityType: 'COMMON',
  extraWithholdingRate: 0,
  custodyChannel: 'CN_BROKER',
};

const transaction: Transaction = {
  id: 'tx-buy',
  instrumentId: '000001.SZ',
  type: 'BUY',
  status: 'CONFIRMED',
  date: '2024-01-01',
  quantity: 1000,
  price: 10,
  amount: 10000,
  currency: 'CNY',
  fxRate: 1,
};

const plan: InvestmentPlan = {
  id: 'plan-1',
  instrumentId: '000001.SZ',
  amount: 1000,
  frequency: 'MONTHLY',
  executionDay: 15,
  startDate: '2026-01-15',
  holidayPolicy: 'NEXT_TRADING_DAY',
  monthEndPolicy: 'LAST_TRADING_DAY',
  autoConfirm: false,
  status: 'ACTIVE',
};

const PAY_KEY = `000001.SZ|PAY_DATE|${TODAY}`;

function mkBaseState(over: Partial<DataState> = {}): DataState {
  return {
    instruments: [instrument],
    transactions: [transaction],
    plans: [plan],
    dividends: [
      mkDiv({ id: 'd1', actualReceived: 480, status: 'RECONCILED', taxWithheldOverride: 3 }),
      mkDiv({ id: 'manual-1', manual: true }),
    ],
    notifications: [
      {
        id: 'ntf-manual',
        key: 'manual|TAX_BRACKET|2026-01-01',
        type: 'TAX_BRACKET',
        title: '手工通知',
        body: '不应被自动重算清掉',
        severity: 'INFO',
        createdAt: '2026-01-01',
        read: false,
      },
      {
        id: `gen-${PAY_KEY}`,
        key: PAY_KEY,
        type: 'PAY_DATE',
        title: '上一轮生成',
        body: '旧内容',
        severity: 'WARN',
        createdAt: '2026-01-01',
        read: true,
      },
    ] as Notification[],
    prices: [{ instrumentId: '000001.SZ', date: '2020-01-01', price: 1, currency: 'CNY', fxRate: 1, source: 'old' }],
    fx: [{ date: '2020-01-01', rates: { USDCNY: 6.5 } }],
    lastUpdated: '2020-01-01T00:00:00Z',
    sourceHealth: { old: { lastSuccess: '2020-01-01T00:00:00Z', consecutiveFailures: 9, status: 'RED' } },
    ...over,
  };
}

const newPrices: PriceSnapshot[] = [
  { instrumentId: '000001.SZ', date: TODAY, price: 12, currency: 'CNY', fxRate: 1, source: 'akshare' },
];
const newFx: FxSnapshot[] = [{ date: TODAY, rates: { USDCNY: 7.2 } }];

function mkBundle(over: Partial<MarketDataBundle> = {}): MarketDataBundle {
  return {
    prices: newPrices,
    fx: newFx,
    dividends: [
      mkDiv({ id: 'd1', status: 'PAID', perShareAmount: 0.6 }),
      mkDiv({ id: 'd2', status: 'DECLARED', recordDate: '2026-07-01', exDate: '2026-07-02', payDate: TODAY }),
    ],
    sourceHealth: { 'akshare.a': { lastSuccess: `${TODAY}T04:00:00Z`, consecutiveFailures: 0, status: 'GREEN' } },
    lastUpdated: `${TODAY}T04:13:12Z`,
    meta: null,
    warnings: [],
    ...over,
  };
}

describe('applyMarketData（覆盖市场切片 / 保留个人数据 / 重算通知）', () => {
  it('市场切片被管道数据完整覆盖', () => {
    const next = applyMarketData(mkBaseState(), mkBundle(), settings);
    expect(next.prices).toEqual(newPrices);
    expect(next.fx).toEqual(newFx);
    expect(next.sourceHealth).toEqual(mkBundle().sourceHealth);
    expect(next.lastUpdated).toBe(`${TODAY}T04:13:12Z`);
    expect(next.prices.some((p) => p.source === 'old')).toBe(false);
  });

  it('个人数据（标的 / 流水 / 定投计划）原样保留，引用不变', () => {
    const base = mkBaseState();
    const next = applyMarketData(base, mkBundle(), settings);
    expect(next.instruments).toBe(base.instruments);
    expect(next.transactions).toBe(base.transactions);
    expect(next.plans).toBe(base.plans);
  });

  it('分红按 mergeDividends 合并：管道事实 + 用户订正 + 手工事件', () => {
    const next = applyMarketData(mkBaseState(), mkBundle(), settings);
    const byId = new Map(next.dividends.map((d) => [d.id, d]));
    expect([...byId.keys()].sort()).toEqual(['d1', 'd2', 'manual-1']);
    expect(byId.get('d1')!.perShareAmount).toBe(0.6);
    expect(byId.get('d1')!.actualReceived).toBe(480);
    expect(byId.get('d1')!.taxWithheldOverride).toBe(3);
  });

  it('★推导不存储：写回 state 的分红仍是占位 0，推导只用于通知', () => {
    const next = applyMarketData(mkBaseState(), mkBundle(), settings);
    for (const d of next.dividends) {
      expect(d.quantityAtRecord).toBe(0);
      expect(d.grossAmount).toBe(0);
      expect(d.netAmount).toBe(0);
    }
  });

  it('★通知在 TaxEngine 推导之后生成：金额不是占位 0', () => {
    const next = applyMarketData(mkBaseState(), mkBundle(), settings);
    const pay = next.notifications.find((n) => n.type === 'PAY_DATE')!;
    expect(pay).toBeDefined();
    // 0.5/股 × 1000 股，2024-01-01 建仓 → 持股 >1年 免税 → 到手 500
    expect(pay.body).toContain('¥500');
    expect(pay.body).not.toContain('¥0');
  });

  it('已读状态按 dedup key 继承，刷新后不重新变红点', () => {
    const next = applyMarketData(mkBaseState(), mkBundle(), settings);
    const pay = next.notifications.find((n) => n.key === PAY_KEY)!;
    expect(pay.read).toBe(true);
    expect(pay.id).toBe(`gen-${PAY_KEY}`);
    expect(pay.title).not.toBe('上一轮生成'); // 已被重新生成
  });

  it('手工通知保留，上一轮自动生成的通知不重复堆积', () => {
    const next = applyMarketData(mkBaseState(), mkBundle(), settings);
    expect(next.notifications.some((n) => n.id === 'ntf-manual')).toBe(true);
    const keys = next.notifications.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('重复调用幂等：通知数量不随刷新次数增长', () => {
    const once = applyMarketData(mkBaseState(), mkBundle(), settings);
    const twice = applyMarketData(once, mkBundle(), settings);
    const thrice = applyMarketData(twice, mkBundle(), settings);
    expect(twice.notifications).toHaveLength(once.notifications.length);
    expect(thrice.notifications).toHaveLength(once.notifications.length);
    expect(thrice.dividends).toHaveLength(once.dividends.length);
  });

  it('空 bundle（管道全挂）不破坏个人数据，也不抛异常', () => {
    const base = mkBaseState();
    const next = applyMarketData(
      base,
      { prices: [], fx: [], dividends: [], sourceHealth: {}, lastUpdated: '', meta: null, warnings: [] },
      settings,
    );
    expect(next.instruments).toBe(base.instruments);
    expect(next.transactions).toBe(base.transactions);
    expect(next.plans).toBe(base.plans);
    expect(next.prices).toEqual([]);
    // 手工录入和已经校准过的管道分红都属于个人账本，管道临时全挂也不能丢。
    expect(next.dividends.map((d) => d.id)).toEqual(['d1', 'manual-1']);
    expect(next.dividends.find((d) => d.id === 'd1')?.actualReceived).toBe(480);
  });

  it('不修改传入的 base state（reducer 纯函数约束）', () => {
    const base = mkBaseState();
    const snapshot = JSON.stringify(base);
    applyMarketData(base, mkBundle(), settings);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

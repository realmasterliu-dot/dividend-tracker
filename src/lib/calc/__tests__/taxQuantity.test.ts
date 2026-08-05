import { describe, expect, it } from 'vitest';
import { AppSettings, DividendEvent, FxSnapshot, Instrument, Transaction } from '@/types';
import { EnrichContext, enrichDividend, entitlementDate, resolveQuantityAtRecord } from '../tax';
import { buildTaxLots } from '../position';
import { addDays } from '../../clock';

/**
 * 登记日持股推导（数据管道接入）—— tax.ts entitlementDate / resolveQuantityAtRecord / enrichDividend
 *
 * 背景：管道不掌握用户持仓，产出的 quantityAtRecord 恒为 0，
 * 由 TaxEngine 按「登记日 ?? 除息日 ?? 派息日」从确认流水推导（推导不存储）。
 */

const TODAY = '2026-08-04';

function mkInstrument(over: Partial<Instrument> = {}): Instrument {
  return {
    id: '000001.SZ',
    symbol: '000001.SZ',
    name: '平安银行',
    market: 'A_SHARE',
    currency: 'CNY',
    dividendEligible: true,
    securityType: 'COMMON',
    extraWithholdingRate: 0,
    custodyChannel: 'CN_BROKER',
    ...over,
  };
}

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

function mkTx(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    instrumentId: '000001.SZ',
    type: 'BUY',
    status: 'CONFIRMED',
    date: '2026-01-01',
    quantity: 1000,
    price: 10,
    amount: 10000,
    currency: 'CNY',
    fxRate: 1,
    ...over,
  } as Transaction;
}

/** 管道产出形态：派生字段一律 0 占位 */
function mkPipelineDiv(over: Partial<DividendEvent> & { id: string }): DividendEvent {
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

function mkCtx(transactions: Transaction[], over: Partial<EnrichContext> = {}): EnrichContext {
  return {
    instruments: [mkInstrument()],
    lotsMap: buildTaxLots(transactions),
    settings: mkSettings(),
    fx: [],
    today: TODAY,
    transactions,
    ...over,
  };
}

// ============================================================

describe('entitlementDate（权益归属基准日：登记日 > 除息日 > 派息日）', () => {
  it('三个日期齐全时取股权登记日', () => {
    const d = mkPipelineDiv({ id: 'a', recordDate: '2026-05-20', exDate: '2026-05-21', payDate: '2026-06-30' });
    expect(entitlementDate(d)).toBe('2026-05-20');
  });

  it('缺股权登记日时回退到除息日', () => {
    const d = mkPipelineDiv({ id: 'b', recordDate: undefined, exDate: '2026-05-21', payDate: '2026-06-30' });
    expect(entitlementDate(d)).toBe('2026-05-21');
  });

  it('仅有派息日时回退到派息日', () => {
    const d = mkPipelineDiv({ id: 'c', recordDate: undefined, exDate: undefined, payDate: '2026-06-30' });
    expect(entitlementDate(d)).toBe('2026-06-30');
  });

  it('三个日期全缺 → undefined（无法归属权益）', () => {
    const d = mkPipelineDiv({ id: 'd', recordDate: undefined, exDate: undefined, payDate: undefined });
    expect(entitlementDate(d)).toBeUndefined();
  });

  it('权益基准日与换汇基准日口径不同：前者登记日优先，后者派息日优先', () => {
    // 换汇发生在派息到账时点，权益归属发生在登记日 —— 两者不可混用
    const d = mkPipelineDiv({ id: 'e', recordDate: '2026-05-20', payDate: '2026-06-30' });
    expect(entitlementDate(d)).toBe('2026-05-20');
    expect(entitlementDate(d)).not.toBe(d.payDate);
  });
});

// ============================================================

describe('resolveQuantityAtRecord · 路径一：事件自带正数（用户事实优先）', () => {
  it('自带正数时直接沿用，不被流水推导覆盖', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const d = mkPipelineDiv({ id: 'x', quantityAtRecord: 777 });
    expect(resolveQuantityAtRecord(d, txs)).toBe(777);
  });

  it('自带正数且完全没有流水时也沿用（手工录入场景）', () => {
    const d = mkPipelineDiv({ id: 'x', quantityAtRecord: 300 });
    expect(resolveQuantityAtRecord(d, [])).toBe(300);
    expect(resolveQuantityAtRecord(d, undefined)).toBe(300);
  });

  it('自带 0 / 负数 / 非有限值 → 不视为用户事实，转入推导路径', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'z', quantityAtRecord: 0 }), txs)).toBe(1000);
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'n', quantityAtRecord: -50 }), txs)).toBe(1000);
    expect(
      resolveQuantityAtRecord(mkPipelineDiv({ id: 'q', quantityAtRecord: Number.NaN }), txs),
    ).toBe(1000);
  });
});

describe('resolveQuantityAtRecord · 路径二：按登记日从流水推导', () => {
  it('管道事件（0 占位）+ 确认流水 → 推导出登记日持股', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'x' }), txs)).toBe(1000);
  });

  it('无流水 / 流水为空数组 → 0', () => {
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'x' }), undefined)).toBe(0);
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'x' }), [])).toBe(0);
  });

  it('登记日当天买入 → 计入（收盘持有即享分红）', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-05-20', quantity: 500 })];
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'x', recordDate: '2026-05-20' }), txs)).toBe(500);
  });

  it('登记日之后才买入 → 不计入', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-05-21', quantity: 500 })];
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'x', recordDate: '2026-05-20' }), txs)).toBe(0);
  });

  it('登记日前部分卖出 → 按净额推导（FIFO 消耗后的剩余）', () => {
    const txs = [
      mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 }),
      mkTx({ id: 'sell', type: 'SELL', date: '2026-03-01', quantity: -400 }),
    ];
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'x' }), txs)).toBe(600);
  });

  it('登记日前已清仓 → 0，且不会出现负数', () => {
    const txs = [
      mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 }),
      mkTx({ id: 'sell', type: 'SELL', date: '2026-03-01', quantity: -1000 }),
    ];
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'x' }), txs)).toBe(0);
  });

  it('登记日前送转（BONUS ratio）→ 按比例放大后的股数', () => {
    const txs = [
      mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 }),
      mkTx({ id: 'bonus', type: 'BONUS', date: '2026-03-01', quantity: 0, meta: { ratio: 1.5 } }),
    ];
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'x' }), txs)).toBe(1500);
  });

  it('PENDING / VOIDED 流水不参与推导（仅确认流水为准）', () => {
    const txs = [
      mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 }),
      mkTx({ id: 'pending', date: '2026-02-01', quantity: 500, status: 'PENDING' }),
      mkTx({ id: 'voided', date: '2026-02-02', quantity: 300, status: 'VOIDED' }),
    ];
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'x' }), txs)).toBe(1000);
  });

  it('其它标的的流水不串号', () => {
    const txs = [
      mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 }),
      mkTx({ id: 'other', instrumentId: '600519.SH', date: '2026-01-02', quantity: 88 }),
    ];
    expect(resolveQuantityAtRecord(mkPipelineDiv({ id: 'x' }), txs)).toBe(1000);
  });

  it('按回退顺序取基准日：缺登记日用除息日，再缺用派息日', () => {
    // 2026-05-20 买入 → 登记日(05-19)口径为 0，除息日(05-21)口径为 800
    const txs = [mkTx({ id: 'buy', date: '2026-05-20', quantity: 800 })];
    expect(
      resolveQuantityAtRecord(
        mkPipelineDiv({ id: 'r', recordDate: '2026-05-19', exDate: '2026-05-21', payDate: '2026-06-30' }),
        txs,
      ),
    ).toBe(0);
    expect(
      resolveQuantityAtRecord(
        mkPipelineDiv({ id: 'e', recordDate: undefined, exDate: '2026-05-21', payDate: '2026-06-30' }),
        txs,
      ),
    ).toBe(800);
    expect(
      resolveQuantityAtRecord(
        mkPipelineDiv({ id: 'p', recordDate: undefined, exDate: undefined, payDate: '2026-06-30' }),
        txs,
      ),
    ).toBe(800);
  });

  it('三个日期全缺 → 无法归属权益，返回 0', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const d = mkPipelineDiv({ id: 'x', recordDate: undefined, exDate: undefined, payDate: undefined });
    expect(resolveQuantityAtRecord(d, txs)).toBe(0);
  });
});

describe('resolveQuantityAtRecord · 路径三：建仓前的历史派息', () => {
  it('用户建仓前的分红推导为 0（那时并未持有，不应有到手金额）', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const old = mkPipelineDiv({
      id: 'old',
      recordDate: '1991-04-30',
      exDate: '1991-05-02',
      payDate: '1991-05-02',
      perShareAmount: 0.3,
    });
    expect(resolveQuantityAtRecord(old, txs)).toBe(0);
  });

  it('管道回溯的多笔历史派息中，只有建仓后的才有持股数', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const before = mkPipelineDiv({ id: 'b', recordDate: '2025-06-01' });
    const after = mkPipelineDiv({ id: 'a', recordDate: '2026-06-01' });
    expect(resolveQuantityAtRecord(before, txs)).toBe(0);
    expect(resolveQuantityAtRecord(after, txs)).toBe(1000);
  });
});

// ============================================================

describe('enrichDividend · 推导数量驱动 gross / tax / net 重算', () => {
  it('管道占位 0 → 按流水推导后重算 gross，并回填三态税（A股 10% 档）', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const enriched = enrichDividend(mkPipelineDiv({ id: 'x', perShareAmount: 0.5 }), mkCtx(txs));

    expect(enriched.quantityAtRecord).toBe(1000);
    expect(enriched.grossAmount).toBeCloseTo(500, 6); // 0.5 × 1000 × fx1
    // 2026-01-01 建仓 → today 2026-08-04 共 215 天 → 1个月-1年 档
    expect(enriched.taxBracket).toBe('M1_1Y');
    expect(enriched.taxRateApplied).toBeCloseTo(0.1, 6);
    expect(enriched.taxWithheld).toBe(0); // A股先派后税
    expect(enriched.contingentTax).toBeCloseTo(50, 6);
    expect(enriched.netAmount).toBeCloseTo(450, 6);
    expect(enriched.daysToZeroTax).toBe(365 - 215);
  });

  it('建仓前派息：quantityAtRecord 推导为 0 → gross / contingent / net 全 0（无 NaN）', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const enriched = enrichDividend(
      mkPipelineDiv({ id: 'old', recordDate: '2024-05-20', exDate: '2024-05-21', payDate: '2024-06-30' }),
      mkCtx(txs),
    );

    expect(enriched.quantityAtRecord).toBe(0);
    expect(enriched.grossAmount).toBe(0);
    expect(enriched.contingentTax).toBe(0);
    expect(enriched.taxWithheld).toBe(0);
    expect(enriched.netAmount).toBe(0);
    expect(Number.isNaN(enriched.grossAmount)).toBe(false);
    expect(Number.isNaN(enriched.netAmount)).toBe(false);
    // 税率仍反映当前持仓的税档（金额为 0 但档位口径不丢）
    expect(enriched.taxRateApplied).toBeCloseTo(0.1, 6);
  });

  it('事件自带正数时以其为准，不被流水推导改写', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const enriched = enrichDividend(
      mkPipelineDiv({ id: 'manual', quantityAtRecord: 200, perShareAmount: 0.5, manual: true }),
      mkCtx(txs),
    );
    expect(enriched.quantityAtRecord).toBe(200);
    expect(enriched.grossAmount).toBeCloseTo(100, 6);
  });

  it('A股 ≤1个月档：推导数量 × 20% 或有税负', () => {
    const buyDate = addDays(TODAY, -10);
    const txs = [mkTx({ id: 'buy', date: buyDate, quantity: 1000 })];
    const enriched = enrichDividend(
      mkPipelineDiv({ id: 'x', recordDate: addDays(TODAY, -5), exDate: addDays(TODAY, -4), payDate: addDays(TODAY, -1) }),
      mkCtx(txs),
    );
    expect(enriched.quantityAtRecord).toBe(1000);
    expect(enriched.taxBracket).toBe('LE1M');
    expect(enriched.contingentTax).toBeCloseTo(500 * 0.2, 6);
  });

  it('A股 >1年档：推导数量正常但或有税负归零', () => {
    const txs = [mkTx({ id: 'buy', date: addDays(TODAY, -400), quantity: 1000 })];
    const enriched = enrichDividend(mkPipelineDiv({ id: 'x' }), mkCtx(txs));
    expect(enriched.quantityAtRecord).toBe(1000);
    expect(enriched.taxBracket).toBe('GT1Y');
    expect(enriched.contingentTax).toBe(0);
    expect(enriched.netAmount).toBeCloseTo(500, 6);
  });

  it('美股：推导数量 × 汇率换算本位币，再按 30% 预扣（未填 W-8BEN）', () => {
    const instrument = mkInstrument({
      id: 'AAPL',
      symbol: 'AAPL',
      name: '苹果',
      market: 'US',
      currency: 'USD',
      custodyChannel: 'US_BROKER',
    });
    const txs = [
      mkTx({ id: 'buy', instrumentId: 'AAPL', date: '2026-01-01', quantity: 100, currency: 'USD', fxRate: 7.2 }),
    ];
    const fx: FxSnapshot[] = [{ date: '2026-01-01', rates: { USDCNY: 7.2 } }];
    const enriched = enrichDividend(
      mkPipelineDiv({ id: 'us1', instrumentId: 'AAPL', currency: 'USD', perShareAmount: 0.25 }),
      mkCtx(txs, { instruments: [instrument], fx }),
    );

    expect(enriched.quantityAtRecord).toBe(100);
    expect(enriched.grossAmount).toBeCloseTo(0.25 * 100 * 7.2, 6); // 180 CNY
    expect(enriched.taxRateApplied).toBeCloseTo(0.3, 6);
    expect(enriched.taxWithheld).toBeCloseTo(54, 6);
    expect(enriched.contingentTax).toBe(0);
    expect(enriched.netAmount).toBeCloseTo(126, 6);
  });

  it('taxWithheldOverride 覆盖引擎估算，并参与 net 计算', () => {
    const instrument = mkInstrument({ id: 'AAPL', market: 'US', currency: 'USD', custodyChannel: 'US_BROKER' });
    const txs = [mkTx({ id: 'buy', instrumentId: 'AAPL', date: '2026-01-01', quantity: 100 })];
    const fx: FxSnapshot[] = [{ date: '2026-01-01', rates: { USDCNY: 7.2 } }];
    const enriched = enrichDividend(
      mkPipelineDiv({
        id: 'us2',
        instrumentId: 'AAPL',
        currency: 'USD',
        perShareAmount: 0.25,
        taxWithheldOverride: 20,
      }),
      mkCtx(txs, { instruments: [instrument], fx }),
    );
    expect(enriched.taxWithheld).toBe(20);
    expect(enriched.netAmount).toBeCloseTo(160, 6);
  });

  it('回填 actualReceived 后按重算后的 gross 计算偏差率', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const enriched = enrichDividend(
      mkPipelineDiv({ id: 'x', perShareAmount: 0.5, status: 'RECONCILED', actualReceived: 475 }),
      mkCtx(txs),
    );
    // gross 重算为 500 → 偏差 (475-500)/500 = -5%
    expect(enriched.grossAmount).toBeCloseTo(500, 6);
    expect(enriched.deviationPct).toBeCloseTo(-0.05, 6);
  });

  it('建仓前派息即使被回填也不产生除零偏差率（gross 为 0）', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const enriched = enrichDividend(
      mkPipelineDiv({ id: 'old', recordDate: '2020-05-20', payDate: '2020-06-30', actualReceived: 10 }),
      mkCtx(txs),
    );
    expect(enriched.grossAmount).toBe(0);
    expect(enriched.deviationPct).toBeUndefined();
  });

  it('未登记的标的原样返回，不产生推导字段污染', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const orphan = mkPipelineDiv({ id: 'orphan', instrumentId: 'UNKNOWN' });
    expect(enrichDividend(orphan, mkCtx(txs))).toBe(orphan);
  });

  it('不传 transactions 时退化为原行为（自带值为准，占位 0 保持 0）', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const ctx = mkCtx(txs, { transactions: undefined });
    expect(enrichDividend(mkPipelineDiv({ id: 'x' }), ctx).quantityAtRecord).toBe(0);
    expect(enrichDividend(mkPipelineDiv({ id: 'y', quantityAtRecord: 60 }), ctx).quantityAtRecord).toBe(60);
  });

  it('纯函数：不修改入参（推导不存储）', () => {
    const txs = [mkTx({ id: 'buy', date: '2026-01-01', quantity: 1000 })];
    const source = mkPipelineDiv({ id: 'x', perShareAmount: 0.5 });
    const snapshot = JSON.stringify(source);
    const enriched = enrichDividend(source, mkCtx(txs));

    expect(JSON.stringify(source)).toBe(snapshot);
    expect(source.quantityAtRecord).toBe(0);
    expect(enriched).not.toBe(source);
  });
});

describe('推导口径一致性：resolveQuantityAtRecord 与 PositionEngine 对齐', () => {
  it('按日期有序的流水下，登记日=今日的推导结果 == TaxLot 汇总持股', () => {
    const txs = [
      mkTx({ id: 'buy1', date: '2026-01-01', quantity: 1000 }),
      mkTx({ id: 'sell1', type: 'SELL', date: '2026-03-01', quantity: -400 }),
      mkTx({ id: 'bonus1', type: 'BONUS', date: '2026-04-01', quantity: 0, meta: { ratio: 2 } }),
    ];
    const derived = resolveQuantityAtRecord(mkPipelineDiv({ id: 'x', recordDate: TODAY }), txs);
    const lotTotal = (buildTaxLots(txs).get('000001.SZ') ?? []).reduce((s, l) => s + l.quantity, 0);

    expect(derived).toBe(1200);
    expect(derived).toBe(lotTotal);
  });
});

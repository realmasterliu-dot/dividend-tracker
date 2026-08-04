import { describe, expect, it } from 'vitest';
import { AppSettings, Instrument, TaxLot } from '@/types';
import {
  bracketForDays,
  bracketLabel,
  computeTax,
  enrichDividend,
  isPaidStatus,
  rateForBracket,
  usWithholdingRate,
} from '../tax';
import { EnrichContext } from '../tax';
import { addDays } from '../../clock';

const TODAY = '2026-08-04';

function mkInstrument(over: Partial<Instrument> = {}): Instrument {
  return {
    id: 'TEST',
    symbol: 'TEST',
    name: '测试标的',
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

function mkLot(buyDate: string, qty = 100, cost = 10): TaxLot {
  return {
    id: `lot-${buyDate}`,
    instrumentId: 'TEST',
    buyDate,
    originalBuyDate: buyDate,
    quantity: qty,
    originalQuantity: qty,
    costPerShare: cost,
    costPerShareLocal: cost,
    sourceTxId: `tx-${buyDate}`,
    events: [],
  };
}

describe('A股税档边界（PRD §5.3.3：≤1月20% / 1月-1年10% / >1年0%）', () => {
  it('bracketForDays 边界：30 天仍 20% 档，31 天进 10% 档', () => {
    expect(bracketForDays(0)).toBe('LE1M');
    expect(bracketForDays(30)).toBe('LE1M');
    expect(bracketForDays(31)).toBe('M1_1Y');
    expect(bracketForDays(364)).toBe('M1_1Y');
  });

  it('bracketForDays 边界：365 天起免税（GT1Y）', () => {
    expect(bracketForDays(365)).toBe('GT1Y');
    expect(bracketForDays(1000)).toBe('GT1Y');
  });

  it('rateForBracket 三档税率正确', () => {
    expect(rateForBracket('LE1M')).toBe(0.2);
    expect(rateForBracket('M1_1Y')).toBe(0.1);
    expect(rateForBracket('GT1Y')).toBe(0);
    expect(rateForBracket('NONE')).toBe(0);
  });

  it('computeTax A股：持股 30 天（20% 档）→ 或有税负 200 / 1000', () => {
    const lots = [mkLot(addDays(TODAY, -30))];
    const tax = computeTax(mkInstrument(), lots, mkSettings(), TODAY, 1, 1000);
    expect(tax.rate).toBeCloseTo(0.2, 6);
    expect(tax.contingentTax).toBeCloseTo(200, 6);
    expect(tax.taxWithheld).toBe(0); // 先派后税：当前 0
    expect(tax.bracket).toBe('LE1M');
    expect(tax.daysToZeroTax).toBe(365 - 30);
  });

  it('computeTax A股：持股 31 天（10% 档）→ 或有税负 100 / 1000', () => {
    const lots = [mkLot(addDays(TODAY, -31))];
    const tax = computeTax(mkInstrument(), lots, mkSettings(), TODAY, 1, 1000);
    expect(tax.rate).toBeCloseTo(0.1, 6);
    expect(tax.contingentTax).toBeCloseTo(100, 6);
    expect(tax.bracket).toBe('M1_1Y');
    expect(tax.daysToZeroTax).toBe(365 - 31);
  });

  it('computeTax A股：持股 365 天（免税）→ 或有税负 0', () => {
    const lots = [mkLot(addDays(TODAY, -365))];
    const tax = computeTax(mkInstrument(), lots, mkSettings(), TODAY, 1, 1000);
    expect(tax.rate).toBe(0);
    expect(tax.contingentTax).toBe(0);
    expect(tax.bracket).toBe('GT1Y');
    expect(tax.daysToZeroTax).toBe(0);
  });

  it('computeTax A股：多批次加权（新批次 10% + 老批次 0%）', () => {
    const lots = [
      mkLot(addDays(TODAY, -31), 100),
      mkLot(addDays(TODAY, -400), 100),
    ];
    const tax = computeTax(mkInstrument(), lots, mkSettings(), TODAY, 1, 1000);
    // 加权 = (100*0.1 + 100*0)/200 = 0.05
    expect(tax.rate).toBeCloseTo(0.05, 6);
    expect(tax.contingentTax).toBeCloseTo(50, 6);
  });

  it('daysToZeroTax：所有有税负批次跨过 1 年所需天数', () => {
    // 两个批次：30 天（20%）与 31 天（10%）；最早有税负批次 30 天 → 还需 335 天
    const lots = [mkLot(addDays(TODAY, -30)), mkLot(addDays(TODAY, -31))];
    const tax = computeTax(mkInstrument(), lots, mkSettings(), TODAY, 1, 1000);
    expect(tax.daysToZeroTax).toBe(335);
  });
});

describe('美股税务（PRD §3.2.3：W-8BEN 10% / 未填 30% / REIT·MLP 强制 30% / ADR 额外）', () => {
  it('usWithholdingRate：已填 W-8BEN → 10%', () => {
    const inst = mkInstrument({ market: 'US', currency: 'USD', securityType: 'COMMON' });
    expect(usWithholdingRate(inst, mkSettings({ w8benFilled: true }))).toBe(0.1);
  });

  it('usWithholdingRate：未填 W-8BEN → 30%', () => {
    const inst = mkInstrument({ market: 'US', currency: 'USD', securityType: 'COMMON' });
    expect(usWithholdingRate(inst, mkSettings({ w8benFilled: false }))).toBe(0.3);
  });

  it('usWithholdingRate：REIT / MLP-PTP 强制 30%，与 W-8BEN 无关', () => {
    const reit = mkInstrument({ market: 'US', currency: 'USD', securityType: 'REIT' });
    const mlp = mkInstrument({ market: 'US', currency: 'USD', securityType: 'MLP_PTP' });
    expect(usWithholdingRate(reit, mkSettings({ w8benFilled: true }))).toBe(0.3);
    expect(usWithholdingRate(reit, mkSettings({ w8benFilled: false }))).toBe(0.3);
    expect(usWithholdingRate(mlp, mkSettings({ w8benFilled: true }))).toBe(0.3);
  });

  it('usWithholdingRate：ADR 额外预扣率叠加', () => {
    const adr = mkInstrument({
      market: 'US',
      currency: 'USD',
      securityType: 'ADR',
      extraWithholdingRate: 0.2,
    });
    expect(usWithholdingRate(adr, mkSettings({ w8benFilled: true }))).toBeCloseTo(0.3, 6);
    expect(usWithholdingRate(adr, mkSettings({ w8benFilled: false }))).toBeCloseTo(0.5, 6);
  });

  it('computeTax 美股：taxWithheld = gross × rate，无或有税负', () => {
    const inst = mkInstrument({ market: 'US', currency: 'USD', securityType: 'COMMON' });
    const tax = computeTax(inst, [], mkSettings({ w8benFilled: false }), TODAY, 1, 1000);
    expect(tax.taxWithheld).toBeCloseTo(300, 6);
    expect(tax.contingentTax).toBe(0);
    expect(tax.note).toContain('30%');
  });
});

describe('港股 / 基金 / 加密 / 黄金税务（PRD §5.3.3）', () => {
  it('港股·香港本地券商 → 0% 且注明来源', () => {
    const inst = mkInstrument({ market: 'HK', currency: 'HKD', custodyChannel: 'HK_LOCAL_BROKER' });
    const tax = computeTax(inst, [], mkSettings(), TODAY, 1, 1000);
    expect(tax.rate).toBe(0);
    expect(tax.taxWithheld).toBe(0);
    expect(tax.note).toContain('0%');
  });

  it('港股通 H股 → 20%（预留口径）', () => {
    const inst = mkInstrument({ market: 'HK', currency: 'HKD', custodyChannel: 'HK_STOCK_CONNECT' });
    const tax = computeTax(inst, [], mkSettings(), TODAY, 1, 1000);
    expect(tax.rate).toBeCloseTo(0.2, 6);
    expect(tax.taxWithheld).toBeCloseTo(200, 6);
  });

  it('国内公募基金 → 0%', () => {
    const inst = mkInstrument({ market: 'FUND', currency: 'CNY', securityType: 'FUND' });
    const tax = computeTax(inst, [], mkSettings(), TODAY, 1, 1000);
    expect(tax.rate).toBe(0);
    expect(tax.taxWithheld).toBe(0);
    expect(tax.contingentTax).toBe(0);
    expect(tax.note).toContain('暂不征收');
  });

  it('加密货币 → 不计算税务（仅记录）', () => {
    const inst = mkInstrument({ market: 'CRYPTO', currency: 'USD', securityType: 'CRYPTO' });
    const tax = computeTax(inst, [], mkSettings(), TODAY, 1, 1000);
    expect(tax.rate).toBe(0);
    expect(tax.note).toContain('不计算');
  });

  it('黄金 → 无分红', () => {
    const inst = mkInstrument({ market: 'GOLD', currency: 'CNY', securityType: 'GOLD', dividendEligible: false });
    const tax = computeTax(inst, [], mkSettings(), TODAY, 1, 1000);
    expect(tax.rate).toBe(0);
    expect(tax.note).toContain('不产生分红');
  });

  it('不可分红资产（dividendEligible=false）→ 恒为 0', () => {
    const inst = mkInstrument({ market: 'A_SHARE', dividendEligible: false });
    const tax = computeTax(inst, [mkLot(TODAY)], mkSettings(), TODAY, 1, 1000);
    expect(tax.rate).toBe(0);
    expect(tax.contingentTax).toBe(0);
    expect(tax.note).toContain('不产生分红');
  });
});

describe('enrichDividend（三态推导 + 回填偏差率）', () => {
  function ctx(over: Partial<EnrichContext> = {}): EnrichContext {
    return {
      instruments: [mkInstrument({ id: '000001.SZ', market: 'A_SHARE' })],
      lotsMap: new Map([['000001.SZ', [mkLot(addDays(TODAY, -100), 100)]]]),
      settings: mkSettings(),
      fx: [],
      today: TODAY,
      ...over,
    };
  }

  it('grossAmount = perShare × 数量 × 汇率；A股或有税负按 10% 档', () => {
    const enriched = enrichDividend(
      {
        id: 'd1',
        instrumentId: '000001.SZ',
        status: 'PAID',
        announceDate: '2026-01-01',
        recordDate: '2026-01-15',
        exDate: '2026-01-16',
        payDate: '2026-01-20',
        payDateEstimated: false,
        perShareAmount: 0.5,
        currency: 'CNY',
        quantityAtRecord: 1000,
        grossAmount: 0,
        taxRateApplied: 0,
        taxWithheld: 0,
        contingentTax: 0,
        netAmount: 0,
        taxBracket: 'NONE',
        dividendForm: 'CASH',
        manual: false,
        sourceKey: 'k',
      },
      ctx(),
    );
    expect(enriched.grossAmount).toBeCloseTo(500, 6);
    expect(enriched.taxRateApplied).toBeCloseTo(0.1, 6);
    expect(enriched.contingentTax).toBeCloseTo(50, 6);
    expect(enriched.netAmount).toBeCloseTo(450, 6);
    expect(enriched.taxBracket).toBe('M1_1Y');
  });

  it('回填 actualReceived 后计算 deviationPct', () => {
    const enriched = enrichDividend(
      {
        id: 'd2',
        instrumentId: '000001.SZ',
        status: 'RECONCILED',
        recordDate: '2026-01-15',
        exDate: '2026-01-16',
        payDate: '2026-01-20',
        payDateEstimated: false,
        perShareAmount: 1,
        currency: 'CNY',
        quantityAtRecord: 100,
        grossAmount: 0,
        taxRateApplied: 0,
        taxWithheld: 0,
        contingentTax: 0,
        netAmount: 0,
        actualReceived: 95,
        taxBracket: 'NONE',
        dividendForm: 'CASH',
        manual: false,
        sourceKey: 'k2',
      },
      ctx(),
    );
    // gross = 100；实际到账 95 → 偏差 -5%
    expect(enriched.deviationPct).toBeCloseTo(-0.05, 6);
  });

  it('isPaidStatus 仅 PAID/RECONCILED 视为已到账', () => {
    expect(isPaidStatus('PAID')).toBe(true);
    expect(isPaidStatus('RECONCILED')).toBe(true);
    expect(isPaidStatus('DECLARED')).toBe(false);
    expect(isPaidStatus('PROPOSED')).toBe(false);
  });

  it('bracketLabel 文案覆盖三档', () => {
    expect(bracketLabel('LE1M')).toContain('20%');
    expect(bracketLabel('M1_1Y')).toContain('10%');
    expect(bracketLabel('GT1Y')).toContain('免税');
  });
});

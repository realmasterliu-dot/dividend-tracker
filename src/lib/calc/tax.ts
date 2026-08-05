import {
  AppSettings,
  Currency,
  DividendEvent,
  FxSnapshot,
  Instrument,
  TaxBracket,
  TaxLot,
  TaxResult,
  Transaction,
} from '@/types';
import { fxOn } from './fx';
import { quantityOnDate } from './position';
import { holdingDays, weightedRateByHolding } from './taxLot';

/**
 * ★ TaxEngine —— 三态税务引擎（architecture.md 类图 + PRD §3.2.2/§5.3.3）
 * - A股（先派后税）：≤1月 20% / 1月-1年 10% / >1年 0%；产出或有税负 + 再持有 N 天归零
 * - 港股·香港本地券商：0%
 * - 美股：W-8BEN 已填 10% / 未填 30% / REIT·MLP 强制 30% / ADR 额外预扣
 * - 基金：0%；加密：不计算；黄金：无分红
 */

export function bracketForDays(days: number): TaxBracket {
  if (days <= 30) return 'LE1M';
  if (days < 365) return 'M1_1Y';
  return 'GT1Y';
}

export function rateForBracket(bracket: TaxBracket): number {
  switch (bracket) {
    case 'LE1M':
      return 0.2;
    case 'M1_1Y':
      return 0.1;
    case 'GT1Y':
    case 'NONE':
      return 0;
  }
}

export function bracketLabel(bracket: TaxBracket): string {
  switch (bracket) {
    case 'LE1M':
      return '≤1个月（20%）';
    case 'M1_1Y':
      return '1个月–1年（10%）';
    case 'GT1Y':
      return '>1年（免税）';
    case 'NONE':
      return '不适用';
  }
}

/** 美股税率：W-8BEN / REIT-MLP 强制 / ADR 额外预扣 */
export function usWithholdingRate(instrument: Instrument, settings: AppSettings): number {
  if (instrument.securityType === 'REIT' || instrument.securityType === 'MLP_PTP') return 0.3;
  const base = settings.w8benFilled ? 0.1 : 0.3;
  return Math.min(1, base + (instrument.extraWithholdingRate ?? 0));
}

/** 核心计算：单笔分红的税务拆解（纯函数） */
export function computeTax(
  instrument: Instrument,
  lots: TaxLot[],
  settings: AppSettings,
  today: string,
  fxRate: number,
  grossAmount: number,
): TaxResult {
  if (!instrument.dividendEligible) {
    return {
      bracket: 'NONE',
      rate: 0,
      taxWithheld: 0,
      contingentTax: 0,
      daysToZeroTax: 0,
      note: '该资产不产生分红',
    };
  }

  switch (instrument.market) {
    case 'A_SHARE': {
      const rateFn = (days: number) => rateForBracket(bracketForDays(days));
      const rate = weightedRateByHolding(lots, today, rateFn);
      // 再持有 N 天全部归零 = 最后一个仍有税负的批次跨过 1 年
      const taxableDays = lots
        .filter((lot) => rateFn(holdingDays(lot, today)) > 0)
        .map((lot) => holdingDays(lot, today));
      const daysToZeroTax = taxableDays.length ? Math.max(0, 365 - Math.min(...taxableDays)) : 0;
      const totalQty = lots.reduce((s, lot) => s + lot.quantity, 0) || 1;
      const weightedAvgDays =
        lots.reduce((s, lot) => s + lot.quantity * holdingDays(lot, today), 0) / totalQty;
      return {
        bracket: bracketForDays(weightedAvgDays),
        rate,
        taxWithheld: 0, // 先派后税：卖出时中登补扣，当前 0
        contingentTax: grossAmount * rate,
        daysToZeroTax,
        note: 'A股先派后税：派息到账全额，卖出时按持股期限补扣',
      };
    }
    case 'US': {
      const rate = usWithholdingRate(instrument, settings);
      return {
        bracket: 'NONE',
        rate,
        taxWithheld: grossAmount * rate,
        contingentTax: 0,
        daysToZeroTax: 0,
        note:
          instrument.securityType === 'REIT' || instrument.securityType === 'MLP_PTP'
            ? 'REIT/MLP-PTP 一律 30%，不享受税收协定优惠'
            : settings.w8benFilled
              ? '已填 W-8BEN，按 10% 预扣'
              : '未填 W-8BEN，按 30% 保守估算（[去设置]填写）',
      };
    }
    case 'HK': {
      if (instrument.custodyChannel === 'HK_LOCAL_BROKER') {
        return {
          bracket: 'NONE',
          rate: 0,
          taxWithheld: 0,
          contingentTax: 0,
          daysToZeroTax: 0,
          note: '香港本地券商持有，股息税 0%',
        };
      }
      // 港股通：H股 20%（预留）
      return {
        bracket: 'NONE',
        rate: 0.2,
        taxWithheld: grossAmount * 0.2,
        contingentTax: 0,
        daysToZeroTax: 0,
        note: '港股通 H股 20%（预留口径）',
      };
    }
    case 'FUND': {
      return {
        bracket: 'NONE',
        rate: 0,
        taxWithheld: 0,
        contingentTax: 0,
        daysToZeroTax: 0,
        note: '国内公募基金：个人暂不征收',
      };
    }
    case 'CRYPTO': {
      return {
        bracket: 'NONE',
        rate: 0,
        taxWithheld: 0,
        contingentTax: 0,
        daysToZeroTax: 0,
        note: '加密货币：不计算税务（政策不明确，仅如实记录）',
      };
    }
    case 'GOLD':
    default: {
      return {
        bracket: 'NONE',
        rate: 0,
        taxWithheld: 0,
        contingentTax: 0,
        daysToZeroTax: 0,
        note: '黄金无分红',
      };
    }
  }
}

export interface EnrichContext {
  instruments: Instrument[];
  lotsMap: Map<string, TaxLot[]>;
  settings: AppSettings;
  fx: FxSnapshot[];
  today: string;
  /**
   * 用户流水。数据管道不掌握用户持仓，产出的 quantityAtRecord 恒为 0；
   * 传入流水后由引擎按股权登记日推导实际持股数量（推导不存储）。
   */
  transactions?: Transaction[];
}

/** 权益归属基准日：股权登记日 > 除息日 > 派息日 */
export function entitlementDate(dividend: DividendEvent): string | undefined {
  return dividend.recordDate ?? dividend.exDate ?? dividend.payDate;
}

/**
 * 解析"登记日持股数量"。
 *
 * 优先级：
 * 1. 事件自带正数（种子数据 / 用户手工录入）→ 以其为准，不覆盖用户事实；
 * 2. 否则（真实数据管道产出恒为 0）→ 按登记日从确认流水推导（含 FIFO 卖出与送转比例）。
 *
 * 用户建仓前的历史分红推导结果为 0 —— 这是正确的：那时并未持有，不应有到手金额。
 */
export function resolveQuantityAtRecord(
  dividend: DividendEvent,
  transactions?: Transaction[],
): number {
  const declared = dividend.quantityAtRecord;
  if (Number.isFinite(declared) && declared > 0) return declared;
  if (!transactions || transactions.length === 0) return 0;
  const refDate = entitlementDate(dividend);
  if (!refDate) return 0;
  return Math.max(0, quantityOnDate(dividend.instrumentId, transactions, refDate));
}

/** 分红事件补全：计算 gross/tax/contingent/net 等推导字段（推导不存储） */
export function enrichDividend(dividend: DividendEvent, ctx: EnrichContext): DividendEvent {
  const instrument = ctx.instruments.find((i) => i.id === dividend.instrumentId);
  if (!instrument) return dividend;

  const lots = ctx.lotsMap.get(dividend.instrumentId) ?? [];
  const refDate = dividend.payDate ?? dividend.exDate ?? dividend.recordDate ?? ctx.today;
  const fxRate = fxOn(ctx.fx, dividend.currency, ctx.settings.baseCurrency, refDate);
  const quantityAtRecord = resolveQuantityAtRecord(dividend, ctx.transactions);
  const grossAmount = dividend.perShareAmount * quantityAtRecord * fxRate;

  const tax = computeTax(instrument, lots, ctx.settings, ctx.today, fxRate, grossAmount);

  const taxWithheld = dividend.taxWithheldOverride ?? tax.taxWithheld;
  const contingentTax = tax.contingentTax;
  const netAmount = Math.max(0, grossAmount - taxWithheld - contingentTax);
  const actualReceived = dividend.actualReceived;
  const deviationPct =
    actualReceived !== undefined && grossAmount > 0 ? (actualReceived - grossAmount) / grossAmount : undefined;

  return {
    ...dividend,
    quantityAtRecord,
    grossAmount,
    taxRateApplied: tax.rate,
    taxWithheld,
    contingentTax,
    netAmount,
    deviationPct,
    taxBracket: tax.bracket,
    daysToZeroTax: tax.daysToZeroTax,
  };
}

export function enrichAllDividends(dividends: DividendEvent[], ctx: EnrichContext): DividendEvent[] {
  return dividends.map((d) => enrichDividend(d, ctx));
}

export const baseCurrencyOf = (settings: AppSettings): 'CNY' | 'USD' => settings.baseCurrency;

export function isPaidStatus(status: DividendEvent['status']): boolean {
  return status === 'PAID' || status === 'RECONCILED';
}

export function dividendDisplayCurrency(currency: Currency): Currency {
  return currency;
}

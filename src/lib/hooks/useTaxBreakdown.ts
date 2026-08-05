import { useMemo } from 'react';
import { DividendEvent, TaxLot, TaxResult } from '@/types';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { buildTaxLots } from '@/lib/calc/position';
import { bracketForDays, bracketLabel, enrichAllDividends, rateForBracket } from '@/lib/calc/tax';
import { weightedRateByHolding } from '@/lib/calc/taxLot';
import { daysBetween, todayISO } from '@/lib/clock';

export interface DividendTaxRow {
  dividend: DividendEvent;
  tax: TaxResult;
}

export interface TaxBreakdown {
  instrumentId: string;
  lots: TaxLot[];
  rows: DividendTaxRow[];
  totalGross: number;
  totalWithheld: number;
  totalContingent: number;
  totalNet: number;
  maxDaysToZeroTax: number;
  currentRate: number;
  currentBracketLabel: string;
}

/** 单标的税务拆解（三态 + 再持有 N 天税负归零） */
export function useTaxBreakdown(instrumentId: string): TaxBreakdown {
  const { state } = useData();
  const { settings } = useSettings();

  return useMemo(() => {
    const today = todayISO();
    const lotsMap = buildTaxLots(state.transactions);
    const lots = lotsMap.get(instrumentId) ?? [];
    const enriched = enrichAllDividends(state.dividends, {
      instruments: state.instruments,
      lotsMap,
      settings,
      fx: state.fx,
      today,
      transactions: state.transactions,
    }).filter((d) => d.instrumentId === instrumentId);

    const rows: DividendTaxRow[] = enriched.map((dividend) => ({
      dividend,
      tax: {
        bracket: dividend.taxBracket,
        rate: dividend.taxRateApplied,
        taxWithheld: dividend.taxWithheld,
        contingentTax: dividend.contingentTax,
        daysToZeroTax: dividend.daysToZeroTax ?? 0,
        note: '',
      },
    }));

    const totalGross = enriched.reduce((s, d) => s + d.grossAmount, 0);
    const totalWithheld = enriched.reduce((s, d) => s + d.taxWithheld, 0);
    const totalContingent = enriched.reduce((s, d) => s + d.contingentTax, 0);
    const totalNet = enriched.reduce((s, d) => s + d.netAmount, 0);

    const daysToZero = enriched
      .map((d) => d.daysToZeroTax ?? 0)
      .filter((x) => x > 0);
    const maxDaysToZeroTax = daysToZero.length ? Math.max(...daysToZero) : 0;

    const maxHolding = lots.length
      ? Math.max(...lots.map((lot) => daysBetween(lot.originalBuyDate, today)))
      : 0;
    const bracket = bracketForDays(maxHolding);
    const rateFn = (days: number) => rateForBracket(bracketForDays(days));
    const currentRate = weightedRateByHolding(lots, today, rateFn);

    return {
      instrumentId,
      lots,
      rows,
      totalGross,
      totalWithheld,
      totalContingent,
      totalNet,
      maxDaysToZeroTax,
      currentRate,
      currentBracketLabel: bracketLabel(bracket),
    };
  }, [state, settings, instrumentId]);
}

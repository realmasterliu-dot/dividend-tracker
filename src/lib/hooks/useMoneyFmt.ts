import { useMemo } from 'react';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { latestFx } from '@/lib/calc/fx';
import { currencySymbol, formatMoney, formatNumber, formatSigned } from '@/lib/format';

/**
 * 显示币种换算 hook：把"本位币金额"换算为显示币种后格式化。
 * 架构约定：Engine 层统一换算本位币；UI 层只做"本位币 → 显示币种"的展示换算。
 */
export function useMoneyFmt() {
  const { state } = useData();
  const { settings } = useSettings();

  return useMemo(() => {
    const rate = latestFx(state.fx, settings.baseCurrency, settings.displayCurrency);
    const symbol = currencySymbol(settings.displayCurrency);
    return {
      currency: settings.displayCurrency,
      rate,
      symbol,
      /** 本位币金额 → 显示币种字符串（千分位） */
      fmt: (baseAmount: number, digits = 0): string =>
        `${symbol}${formatNumber(baseAmount * rate, digits)}`,
      /** 同 fmt，但可指定负号等（基于 formatMoney） */
      money: (baseAmount: number, digits = 0): string =>
        formatMoney(baseAmount * rate, settings.displayCurrency, digits),
      /** 带符号（+/-）的显示币种金额 */
      signed: (baseAmount: number, digits = 0): string =>
        formatSigned(baseAmount * rate, digits),
    };
  }, [state.fx, settings.baseCurrency, settings.displayCurrency]);
}

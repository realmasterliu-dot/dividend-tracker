import { useMemo } from 'react';
import { CalendarDayCell, HeatCell, PendingItem } from '@/types';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { buildMonthGrid, classifyPending, heatmap90, timelineEvents } from '@/lib/calendar';
import { buildTaxLots } from '@/lib/calc/position';
import { enrichAllDividends } from '@/lib/calc/tax';
import { todayISO } from '@/lib/clock';

export interface DividendCalendarData {
  month: number;
  year: number;
  grid: CalendarDayCell[];
  pending: PendingItem[];
  heatmap: HeatCell[];
  timeline: { date: string; items: CalendarDayCell['items'] }[];
  monthTotal: number;
  pendingCount: number;
}

/** 日历页数据聚合 + 90 天热力图输入 */
export function useDividendCalendar(monthOffset = 0): DividendCalendarData {
  const { state } = useData();
  const { settings } = useSettings();

  return useMemo(() => {
    const today = todayISO();
    const base = new Date(today);
    const target = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
    const year = target.getFullYear();
    const month = target.getMonth();

    const lotsMap = buildTaxLots(state.transactions);
    const enriched = enrichAllDividends(state.dividends, {
      instruments: state.instruments,
      lotsMap,
      settings,
      fx: state.fx,
      today,
      transactions: state.transactions,
    });

    const grid = buildMonthGrid(enriched, year, month);
    const pending = classifyPending(enriched);
    const heat = heatmap90(enriched, today);
    const timeline = timelineEvents(enriched);

    const monthTotal = grid.reduce(
      (sum, cell) => sum + cell.items.reduce((s, it) => s + it.amount, 0),
      0,
    );

    return {
      month,
      year,
      grid,
      pending,
      heatmap: heat,
      timeline,
      monthTotal,
      pendingCount: pending.length,
    };
  }, [state, settings, monthOffset]);
}

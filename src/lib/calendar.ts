import {
  CalendarDayCell,
  CalendarEventItem,
  DividendEvent,
  HeatCell,
  PendingItem,
} from '@/types';
import { addDays, todayISO } from './clock';

/**
 * CalendarService（architecture.md 类图）
 * 月格映射 / 待定区归类 / 90 天热力图。
 * 三种日期标记（PRD §8.4.3）：●登记日 ◆除息日 ▲到账日（形状区分，不只靠颜色）。
 */

export function markerForDate(dividend: DividendEvent, date: string): CalendarEventItem['marker'] | null {
  if (dividend.recordDate === date) return 'RECORD';
  if (dividend.exDate === date) return 'EX';
  if (dividend.payDate === date) return 'PAY';
  return null;
}

export function eventAmount(dividend: DividendEvent): number {
  return dividend.netAmount;
}

export function buildMonthGrid(dividends: DividendEvent[], year: number, month: number): CalendarDayCell[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: CalendarDayCell[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const items: CalendarEventItem[] = [];
    for (const d of dividends) {
      const marker = markerForDate(d, date);
      if (marker) {
        items.push({ dividend: d, marker, date, amount: eventAmount(d) });
      }
    }
    cells.push({ date, items });
  }
  return cells;
}

/** 日期待定区：有预案/已通过但登记日/除息日未公告（PRD §3.2.1） */
export function classifyPending(dividends: DividendEvent[]): PendingItem[] {
  const items: PendingItem[] = [];
  for (const d of dividends) {
    if (d.status === 'PROPOSED') {
      items.push({ dividend: d, stage: 'PROPOSED' });
    } else if (d.status === 'APPROVED') {
      items.push({ dividend: d, stage: 'APPROVED' });
    } else if ((d.status === 'DECLARED' || d.status === 'EX_DIVIDEND') && !d.exDate && !d.recordDate) {
      items.push({ dividend: d, stage: 'APPROVED' });
    }
  }
  return items;
}

/** 未来 90 天分红日历热力图（颜色深浅 = 金额） */
export function heatmap90(dividends: DividendEvent[], today = todayISO()): HeatCell[] {
  const cells: HeatCell[] = [];
  const map = new Map<string, { amount: number; count: number }>();
  for (const d of dividends) {
    if (d.status === 'PROPOSED' || d.status === 'APPROVED') continue; // 日期未定不进热力图
    const target = d.payDate ?? d.exDate ?? d.recordDate;
    if (!target) continue;
    if (target < today || target > addDays(today, 89)) continue;
    const cur = map.get(target) ?? { amount: 0, count: 0 };
    cur.amount += eventAmount(d);
    cur.count += 1;
    map.set(target, cur);
  }
  for (let i = 0; i < 90; i++) {
    const date = addDays(today, i);
    const cell = map.get(date);
    cells.push({ date, amount: cell?.amount ?? 0, count: cell?.count ?? 0 });
  }
  return cells;
}

/** 时间轴视图：按日期排序的全部事件（含待定区） */
export function timelineEvents(dividends: DividendEvent[]): { date: string; items: CalendarEventItem[] }[] {
  const map = new Map<string, CalendarEventItem[]>();
  for (const d of dividends) {
    const dates = [d.recordDate, d.exDate, d.payDate].filter((x): x is string => Boolean(x));
    for (const date of dates) {
      const marker = markerForDate(d, date);
      if (!marker) continue;
      const list = map.get(date) ?? [];
      list.push({ dividend: d, marker, date, amount: eventAmount(d) });
      map.set(date, list);
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, items]) => ({ date, items }));
}

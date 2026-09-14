import React from 'react';
import clsx from 'clsx';
import { CalendarDayCell } from '@/types';
import { DateMarker } from './DateMarker';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { todayISO } from '@/lib/clock';

interface MonthGridProps {
  grid: CalendarDayCell[];
  year: number;
  month: number;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

/** 月视图热力格：●登记日 ◆除息日 ▲到账日，底色深浅 = 当日到账金额 */
export function MonthGrid({ grid, year, month }: MonthGridProps) {
  const { fmt } = useMoneyFmt();
  const today = todayISO();

  const firstDay = new Date(year, month, 1).getDay(); // 0=周日
  const leading = (firstDay + 6) % 7; // 周一开头
  const cells: (CalendarDayCell | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...grid,
  ];

  const maxDayAmount = Math.max(1, ...grid.map((c) => c.items.reduce((s, it) => s + it.amount, 0)));

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-0.5 sm:gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 text-center text-[10px] text-disabled">
            <span className="sm:hidden">{w}</span><span className="hidden sm:inline">周{w}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} className="min-h-[48px] sm:min-h-[72px]" />;
          const dayAmount = cell.items.reduce((s, it) => s + it.amount, 0);
          const intensity = Math.min(1, dayAmount / maxDayAmount);
          const isToday = cell.date === today;
          return (
            <div
              key={cell.date}
              aria-label={`${cell.date}，${cell.items.length} 个分红日程${dayAmount > 0 ? `，金额 ${fmt(dayAmount, 0)}` : ''}`}
              className={clsx(
                'min-w-0 min-h-[48px] overflow-hidden rounded-md border p-1 transition-colors sm:min-h-[72px] sm:p-1.5',
                dayAmount > 0
                  ? 'border-gold/30 bg-gold/5'
                  : 'border-line bg-card/40',
                isToday && 'ring-1 ring-inset ring-declared',
              )}
            >
              <div className="flex items-center justify-between">
                <span className={clsx('num text-[11px]', isToday ? 'font-semibold text-declared' : dayAmount > 0 ? 'text-gold' : 'text-disabled')}>
                  {Number(cell.date.slice(8))}
                </span>
                {dayAmount > 0 && (
                  <span
                    className="hidden h-1 rounded-full bg-gold sm:block"
                    style={{ width: `${Math.max(8, intensity * 24)}px` }}
                  />
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
                {cell.items.slice(0, 3).map((item) => (
                  <DateMarker key={`${item.dividend.id}-${item.marker}`} shape={item.marker} status={item.dividend.status} />
                ))}
                {cell.items.length > 3 && <span className="text-[8px] leading-2 text-disabled">+{cell.items.length - 3}</span>}
              </div>
              <div className="mt-1 hidden space-y-1 sm:block">
                {cell.items.map((item, idx) => (
                  <div key={`${item.dividend.id}-${item.marker}-${idx}`} className="flex min-w-0 items-center gap-1 text-[10px] leading-none">
                    <DateMarker shape={item.marker} status={item.dividend.status} />
                    <span className="font-mono truncate">{item.dividend.instrumentId}</span>
                  </div>
                ))}
              </div>
              {dayAmount > 0 && (
                <div className="mt-1 hidden truncate text-right num text-[10px] text-gold sm:block">{fmt(dayAmount, 0)}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

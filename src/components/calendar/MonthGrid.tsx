import React from 'react';
import clsx from 'clsx';
import { CalendarDayCell } from '@/types';
import { DateMarker } from './DateMarker';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';

interface MonthGridProps {
  grid: CalendarDayCell[];
  year: number;
  month: number;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

/** 月视图热力格：●登记日 ◆除息日 ▲到账日，底色深浅 = 当日到账金额 */
export function MonthGrid({ grid, year, month }: MonthGridProps) {
  const { fmt } = useMoneyFmt();

  const firstDay = new Date(year, month, 1).getDay(); // 0=周日
  const leading = (firstDay + 6) % 7; // 周一开头
  const total = grid.length;

  const cells: (CalendarDayCell | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...grid,
  ];

  const maxDayAmount = Math.max(1, ...grid.map((c) => c.items.reduce((s, it) => s + it.amount, 0)));

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[10px] text-disabled py-1">
            周{w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} />;
          const dayAmount = cell.items.reduce((s, it) => s + it.amount, 0);
          const intensity = Math.min(1, dayAmount / maxDayAmount);
          return (
            <div
              key={cell.date}
              className={clsx(
                'min-h-[64px] rounded-md border p-1.5 transition-colors',
                dayAmount > 0
                  ? 'border-gold/30 bg-gold/5'
                  : 'border-line bg-card/40',
              )}
            >
              <div className="flex items-center justify-between">
                <span className={clsx('num text-[11px]', dayAmount > 0 ? 'text-gold' : 'text-disabled')}>
                  {Number(cell.date.slice(8))}
                </span>
                {dayAmount > 0 && (
                  <span
                    className="h-1 rounded-full bg-gold"
                    style={{ width: `${Math.max(8, intensity * 24)}px` }}
                  />
                )}
              </div>
              <div className="mt-1 space-y-1">
                {cell.items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-1 text-[10px] leading-none">
                    <DateMarker shape={item.marker} status={item.dividend.status} />
                    <span className="font-mono truncate">{item.dividend.instrumentId}</span>
                  </div>
                ))}
              </div>
              {dayAmount > 0 && (
                <div className="mt-1 num text-[10px] text-gold">{fmt(dayAmount, 0)}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

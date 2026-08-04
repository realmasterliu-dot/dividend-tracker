import React from 'react';
import { CalendarDayCell } from '@/types';
import { DateMarker, markerLabel } from './DateMarker';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';

/** 时间轴视图：按日期排序的全部事件 */
export function TimelineView({ timeline }: { timeline: { date: string; items: CalendarDayCell['items'] }[] }) {
  const { fmt } = useMoneyFmt();

  return (
    <div className="relative pl-6">
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-line" />
      {timeline.map((entry) => (
        <div key={entry.date} className="relative mb-4">
          <span className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full border-2 border-gold bg-card" />
          <div className="text-[12px] font-mono text-primary mb-1">{entry.date}</div>
          <div className="space-y-1">
            {entry.items.map((item, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-card/50 px-2.5 py-1.5"
              >
                <DateMarker shape={item.marker} status={item.dividend.status} />
                <span className="text-[11px] text-secondary">{markerLabel(item.marker)}</span>
                <span className="text-[12px] text-primary font-medium">{item.dividend.instrumentId}</span>
                <span className="num text-[12px] text-gold">{fmt(item.amount, 0)}</span>
                <span className="text-[10px] text-disabled">{item.dividend.status}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

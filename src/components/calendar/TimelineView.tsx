import React from 'react';
import { CalendarDayCell } from '@/types';
import { DateMarker, markerLabel } from './DateMarker';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { useData } from '@/store/DataContext';
import { todayISO } from '@/lib/clock';

const STATUS_LABELS = {
  PROPOSED: '预案',
  APPROVED: '已通过',
  DECLARED: '已宣告',
  EX_DIVIDEND: '已除息',
  PAID: '已到账',
  RECONCILED: '已核对',
} as const;

function isReceivedStatus(status: CalendarDayCell['items'][number]['dividend']['status']): boolean {
  return status === 'PAID' || status === 'RECONCILED';
}

export function timelineAmountLabel(
  marker: CalendarDayCell['items'][number]['marker'],
  status: CalendarDayCell['items'][number]['dividend']['status'],
): string {
  if (marker !== 'PAY') return '预计分红';
  return isReceivedStatus(status) ? '已到账' : '预计到账';
}

function friendlyDate(date: string, today: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parsed.getDay()];
  const label = `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
  return date === today ? `今天 · ${label}` : `${label} · ${week}`;
}

/** 时间轴视图：按日期排序的全部事件 */
export function TimelineView({ timeline }: { timeline: { date: string; items: CalendarDayCell['items'] }[] }) {
  const { fmt } = useMoneyFmt();
  const { state } = useData();
  const today = todayISO();
  const instruments = new Map(state.instruments.map((instrument) => [instrument.id, instrument]));
  const upcoming = timeline.filter((entry) => entry.date >= today);
  const elapsed = timeline.filter((entry) => entry.date < today).reverse();

  if (timeline.length === 0) {
    return (
      <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-line px-5 text-center">
        <div className="mb-2 text-[24px]" aria-hidden="true">○</div>
        <p className="text-[14px] font-medium text-primary">这个月还没有分红日程</p>
        <p className="mt-1 text-[12px] text-secondary">已宣告的登记、除息和到账日期会显示在这里。</p>
      </div>
    );
  }

  const renderEntries = (entries: typeof timeline) => entries.map((entry) => {
    const payItems = entry.items.filter((item) => item.marker === 'PAY');
    const payAmount = payItems.reduce(
      (sum, item) => sum + (item.dividend.actualReceived ?? item.amount),
      0,
    );
    const payAmountLabel = payItems.every((item) => isReceivedStatus(item.dividend.status))
      ? '已到账'
      : '预计到账';

    return (
      <article key={entry.date} className="relative pb-5 last:pb-0">
        <span className="absolute -left-[25px] top-1.5 h-3 w-3 rounded-full border-2 border-gold bg-card" />
        <div className="mb-2 flex min-h-7 items-center justify-between gap-3">
          <time dateTime={entry.date} className="text-[13px] font-semibold text-primary">
            {friendlyDate(entry.date, today)}
          </time>
          {payItems.length > 0 && (
            <span className="num shrink-0 text-[13px] font-semibold text-gold">{payAmountLabel} {fmt(payAmount, 0)}</span>
          )}
        </div>
        <div className="space-y-2">
          {entry.items.map((item, idx) => {
            const instrument = instruments.get(item.dividend.instrumentId);
            const displayedAmount = item.marker === 'PAY'
              ? (item.dividend.actualReceived ?? item.amount)
              : item.amount;
            return (
              <div
                key={`${item.dividend.id}-${item.marker}-${idx}`}
                className="rounded-lg border border-line bg-card/60 px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-h-6 items-center gap-2">
                      <DateMarker shape={item.marker} status={item.dividend.status} size="lg" />
                      <span className="text-[12px] text-secondary">{markerLabel(item.marker)}</span>
                      <span className="rounded bg-page/60 px-1.5 py-0.5 text-[10px] text-disabled">
                        {STATUS_LABELS[item.dividend.status]}
                      </span>
                    </div>
                    <div className="mt-1 flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[14px] font-medium text-primary">
                        {instrument?.name ?? item.dividend.instrumentId}
                      </span>
                      {instrument && (
                        <span className="shrink-0 font-mono text-[11px] text-secondary">{instrument.symbol}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-[15px] font-semibold text-gold">{fmt(displayedAmount, 0)}</div>
                    <div className="mt-0.5 text-[10px] text-disabled">
                      {timelineAmountLabel(item.marker, item.dividend.status)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </article>
    );
  });

  return (
    <div className="space-y-5">
      {upcoming.length > 0 && (
        <section aria-labelledby="calendar-upcoming-title">
          <h3 id="calendar-upcoming-title" className="mb-3 text-[12px] font-medium text-secondary">接下来</h3>
          <div className="relative ml-1.5 border-l border-line pl-5">
            {renderEntries(upcoming)}
          </div>
        </section>
      )}
      {elapsed.length > 0 && (
        <section aria-labelledby="calendar-elapsed-title">
          <h3 id="calendar-elapsed-title" className="mb-3 text-[12px] font-medium text-secondary">本月已过</h3>
          <div className="relative ml-1.5 border-l border-line pl-5 opacity-80">
            {renderEntries(elapsed)}
          </div>
        </section>
      )}
    </div>
  );
}

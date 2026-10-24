import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useDividendCalendar } from '@/lib/hooks/useDividendCalendar';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { PendingZone } from './PendingZone';
import { MonthGrid } from './MonthGrid';
import { TimelineView } from './TimelineView';
import { DateMarker } from './DateMarker';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

function defaultView(): 'month' | 'timeline' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'timeline';
  return window.matchMedia('(min-width: 640px)').matches ? 'month' : 'timeline';
}

/** 分红日历容器：手机默认近期列表，桌面默认月历。 */
export function DividendCalendar() {
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<'month' | 'timeline'>(defaultView);
  const { fmt } = useMoneyFmt();
  const data = useDividendCalendar(offset);
  const monthTimeline = useMemo(
    () => data.grid.filter((cell) => cell.items.length > 0).map((cell) => ({ date: cell.date, items: cell.items })),
    [data.grid],
  );
  const payTotal = useMemo(
    () => data.grid.reduce(
      (total, cell) => total + cell.items
        .filter((item) => item.marker === 'PAY')
        .reduce((sum, item) => sum + item.amount, 0),
      0,
    ),
    [data.grid],
  );
  const eventCount = data.grid.reduce((total, cell) => total + cell.items.length, 0);

  return (
    <div className="space-y-4">
      <Card padding={false}>
        <div className="border-b border-line-soft px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-11 min-h-11 w-11 px-0"
              aria-label="上一个月"
              onClick={() => setOffset((o) => o - 1)}
            >
              <ChevronLeft aria-hidden="true" size={18} />
            </Button>

            <div className="min-w-0 text-center">
              <h2 className="text-[16px] font-semibold text-primary sm:text-[17px]">
                {data.year} 年 {data.month + 1} 月
              </h2>
              <p className="mt-0.5 text-[11px] text-secondary sm:text-[12px]">
                预计到账 <span className="num font-semibold text-gold">{fmt(payTotal, 0)}</span>
                <span className="mx-1.5 text-disabled">·</span>{eventCount} 个日程
              </p>
            </div>

            <Button
              size="sm"
              variant="ghost"
              className="h-11 min-h-11 w-11 px-0"
              aria-label="下一个月"
              onClick={() => setOffset((o) => o + 1)}
            >
              <ChevronRight aria-hidden="true" size={18} />
            </Button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="grid min-h-11 flex-1 grid-cols-2 overflow-hidden rounded-lg border border-line bg-page/40 p-1 text-[13px]">
              <button
                type="button"
                aria-pressed={view === 'timeline'}
                onClick={() => setView('timeline')}
                className={`min-h-9 rounded-md px-3 transition-colors ${view === 'timeline' ? 'bg-card-hover font-medium text-primary' : 'text-secondary'}`}
              >
                近期列表
              </button>
              <button
                type="button"
                aria-pressed={view === 'month'}
                onClick={() => setView('month')}
                className={`min-h-9 rounded-md px-3 transition-colors ${view === 'month' ? 'bg-card-hover font-medium text-primary' : 'text-secondary'}`}
              >
                月历
              </button>
            </div>
            {offset !== 0 && (
              <Button size="sm" variant="outline" className="min-h-11 shrink-0" onClick={() => setOffset(0)}>
                回到本月
              </Button>
            )}
          </div>
        </div>

        <div className="p-3 sm:p-4">
          {view === 'month' ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-secondary">
                <span className="flex items-center gap-1.5"><DateMarker shape="RECORD" status="DECLARED" /> 登记</span>
                <span className="flex items-center gap-1.5"><DateMarker shape="EX" status="DECLARED" /> 除息</span>
                <span className="flex items-center gap-1.5"><DateMarker shape="PAY" status="PAID" /> 到账</span>
                <span className="hidden text-disabled sm:inline">青色为已宣告，金色为已到账，灰色为预测</span>
              </div>
              <MonthGrid grid={data.grid} year={data.year} month={data.month} />
            </>
          ) : (
            <TimelineView timeline={monthTimeline} />
          )}
        </div>
      </Card>

      <PendingZone items={data.pending} />

      <details className="group rounded-lg border border-line bg-card px-3 text-[12px] text-secondary sm:px-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-medium text-primary">
          为什么有些 A 股分红日期待定？
          <span className="text-secondary transition-transform group-open:rotate-45" aria-hidden="true">＋</span>
        </summary>
        <p className="border-t border-line-soft py-3 leading-6">
          A 股分红会分阶段披露。董事会预案和股东大会通过时，可能还没有登记日、除息日和到账日；实施公告发布后，日程会自动进入月历。
        </p>
      </details>
    </div>
  );
}

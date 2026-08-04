import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useDividendCalendar } from '@/lib/hooks/useDividendCalendar';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { PendingZone } from './PendingZone';
import { MonthGrid } from './MonthGrid';
import { TimelineView } from './TimelineView';
import { DateMarker } from './DateMarker';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/** 分红日历容器（月视图/时间轴切换 + 待定区 + 图例） */
export function DividendCalendar() {
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<'month' | 'timeline'>('month');
  const { fmt } = useMoneyFmt();
  const data = useDividendCalendar(offset);

  return (
    <div className="space-y-3">
      {/* 一次性说明卡（PRD §3.2.1 UI 应对 5） */}
      <div className="rounded-lg border border-declared/20 bg-declared/5 px-3 py-2 text-[11px] text-secondary">
        💡 <span className="text-primary font-medium">为什么 A股分红日期经常显示"待定"？</span>
        A股分红分阶段披露：董事会先出预案（金额、无日期）→ 股东大会通过 → 实施分配公告（提前 3-7 个交易日才确定登记日/除息日）。
        因此日期未定的分红显示在上方"待定区"，日期确定后自动落入日历格。
      </div>

      <PendingZone items={data.pending} />

      <Card
        title={`${data.year} 年 ${data.month + 1} 月 · 分红日历`}
        subtitle={`本月预计到账 ${fmt(data.monthTotal, 0)} · 待定 ${data.pendingCount} 项`}
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded border border-line overflow-hidden text-[11px]">
              <button
                onClick={() => setView('month')}
                className={`px-2 py-0.5 ${view === 'month' ? 'bg-gold/15 text-gold' : 'text-secondary hover:text-primary'}`}
              >
                月视图
              </button>
              <button
                onClick={() => setView('timeline')}
                className={`px-2 py-0.5 ${view === 'timeline' ? 'bg-gold/15 text-gold' : 'text-secondary hover:text-primary'}`}
              >
                时间轴
              </button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setOffset((o) => o - 1)}>
              <ChevronLeft size={14} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>
              今月
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOffset((o) => o + 1)}>
              <ChevronRight size={14} />
            </Button>
          </div>
        }
        bodyClassName="p-4"
      >
        {/* 图例 */}
        <div className="flex items-center gap-4 mb-3 text-[11px] text-secondary">
          <span className="flex items-center gap-1"><DateMarker shape="RECORD" status="DECLARED" /> 股权登记日</span>
          <span className="flex items-center gap-1"><DateMarker shape="EX" status="DECLARED" /> 除权除息日</span>
          <span className="flex items-center gap-1"><DateMarker shape="PAY" status="PAID" /> 派息到账日</span>
          <span className="text-disabled">状态：已宣告=青 · 已到账=金 · 预测=灰</span>
        </div>

        {view === 'month' ? (
          <MonthGrid grid={data.grid} year={data.year} month={data.month} />
        ) : (
          <TimelineView timeline={data.timeline} />
        )}
      </Card>
    </div>
  );
}

import React from 'react';
import { DividendCalendar } from '@/components/calendar/DividendCalendar';

/** 分红日历页（月视图 + 待定区 + 时间轴） */
export function CalendarPage() {
  return (
    <div className="p-4">
      <div className="mb-3">
        <h2 className="text-[18px] font-bold text-primary">分红日历</h2>
        <p className="text-[12px] text-secondary mt-0.5">
          ●登记日 ◆除息日 ▲到账日 · 日期未定进入"待定区" · 已宣告=青 / 已到账=金 / 预测=灰
        </p>
      </div>
      <DividendCalendar />
    </div>
  );
}

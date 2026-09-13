import React from 'react';
import { DividendCalendar } from '@/components/calendar/DividendCalendar';

/** 分红日历页：手机优先展示近期事件，桌面可切换完整月历。 */
export function CalendarPage() {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-3 py-4 pb-24 sm:px-5 sm:py-6 sm:pb-8">
      <header className="mb-4 sm:mb-5">
        <h1 className="text-[22px] font-bold tracking-tight text-primary sm:text-[24px]">分红日历</h1>
        <p className="mt-1 text-[13px] text-secondary">一眼看清什么时候除息、什么时候到账。</p>
      </header>
      <DividendCalendar />
    </div>
  );
}

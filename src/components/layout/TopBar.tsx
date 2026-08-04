import React from 'react';
import { TickerTape } from '@/components/dashboard/TickerTape';
import { DataFreshnessBar } from '@/components/dashboard/DataFreshnessBar';
import { useData } from '@/store/DataContext';

/** 顶栏：Ticker Tape + 健康灯 + 最后更新时间 */
export function TopBar() {
  const { state } = useData();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-page/95 backdrop-blur">
      <div className="flex items-center gap-3 h-9 px-3">
        <TickerTape />
        <DataFreshnessBar />
      </div>
    </header>
  );
}

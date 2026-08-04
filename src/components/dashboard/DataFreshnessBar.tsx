import React from 'react';
import { Link } from 'react-router-dom';
import { Circle } from 'lucide-react';
import { useData } from '@/store/DataContext';
import { daysBetween, todayISO } from '@/lib/clock';

/** 右上角常驻：最后更新时间 + 数据源健康指示灯（绿/黄/红） */
export function DataFreshnessBar() {
  const { state } = useData();
  const today = todayISO();

  const statuses = Object.values(state.sourceHealth).map((s) => s.status);
  const worst = statuses.includes('RED') ? 'RED' : statuses.includes('YELLOW') ? 'YELLOW' : 'GREEN';

  const lastUpdatedDays = daysBetween(state.lastUpdated.slice(0, 10), today);
  const isStale = lastUpdatedDays * 24 >= 48;

  const color =
    worst === 'RED' ? 'text-danger' : worst === 'YELLOW' ? 'text-warning' : 'text-healthy';

  return (
    <div className="flex items-center gap-3 text-[11px] text-secondary shrink-0">
      <span className={isStale ? 'text-danger font-medium' : ''}>
        最后更新 {state.lastUpdated.slice(0, 16).replace('T', ' ')} UTC
        {isStale && <span className="ml-1 text-danger">⚠ {lastUpdatedDays}天前</span>}
      </span>
      <Link
        to="/settings"
        className="flex items-center gap-1.5 hover:text-primary transition-colors"
        title="数据源健康：GREEN=正常 YELLOW=降级 RED=异常"
      >
        <Circle size={9} className={`${color} fill-current`} />
        <span className="uppercase tracking-wider">{worst}</span>
      </Link>
    </div>
  );
}

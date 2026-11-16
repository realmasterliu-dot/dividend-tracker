import React from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronRight, Database, Repeat2 } from 'lucide-react';
import { useData } from '@/store/DataContext';
import { Badge } from '@/components/ui/Badge';
import { AppearanceSettings } from './AppearanceSettings';
import { CloudAccountSettings } from './CloudAccountSettings';
import { TaxSettings } from './TaxSettings';
import { DataSettings } from './DataSettings';

export function SettingsPage() {
  const { state } = useData();
  const unread = state.notifications.filter((item) => !item.read).length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-5 lg:p-8">
      <div>
        <h1 className="text-[20px] font-semibold text-primary">更多</h1>
        <p className="mt-1 text-[12px] text-secondary">账号、提醒和常用偏好。</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/notifications"
          className="panel flex min-h-[76px] items-center gap-3 p-3.5 hover:border-gold/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold"><Bell size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-primary">提醒</span>
            <span className="mt-0.5 block text-[10px] text-secondary">{unread > 0 ? `${unread} 条未读` : '暂无未读'}</span>
          </span>
          <ChevronRight size={15} className="text-disabled" />
        </Link>
        <Link
          to="/dca"
          className="panel flex min-h-[76px] items-center gap-3 p-3.5 hover:border-gold/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-declared/10 text-declared"><Repeat2 size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-primary">定投</span>
            <span className="mt-0.5 block text-[10px] text-secondary">{state.plans.length} 个计划</span>
          </span>
          <ChevronRight size={15} className="text-disabled" />
        </Link>
      </div>

      <CloudAccountSettings />
      <AppearanceSettings />
      <TaxSettings />
      <DataSettings />

      <details className="panel group overflow-hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-[12px] text-secondary hover:text-primary">
          <Database size={15} /> 行情数据状态
          <ChevronRight size={14} className="ml-auto transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t border-line px-4 py-3">
          {Object.keys(state.sourceHealth).length === 0 ? (
            <p className="text-[11px] text-disabled">暂未取得数据源状态，账本记录仍可正常使用。</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(state.sourceHealth).map(([name, health]) => (
                <div key={name} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="truncate text-secondary">{name}</span>
                  <Badge variant={health.status === 'GREEN' ? 'green' : health.status === 'YELLOW' ? 'orange' : 'red'}>
                    {health.status === 'GREEN' ? '正常' : health.status === 'YELLOW' ? '降级' : '异常'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

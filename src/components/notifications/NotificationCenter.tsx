import React, { useMemo, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Notification, Severity } from '@/types';
import { useData } from '@/store/DataContext';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

const severityVariant = { INFO: 'cyan', WARN: 'orange', ERROR: 'red' } as const;

/** 站内通知中心（分类/已读/防重复 key） */
export function NotificationCenter() {
  const { state, markNotificationRead, markAllNotificationsRead } = useData();
  const [filter, setFilter] = useState<'ALL' | 'UNREAD' | Severity>('ALL');

  const list = useMemo(() => {
    let items = [...state.notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (filter === 'UNREAD') items = items.filter((n) => !n.read);
    else if (filter === 'INFO' || filter === 'WARN' || filter === 'ERROR') items = items.filter((n) => n.severity === filter);
    return items;
  }, [state.notifications, filter]);

  const unreadCount = state.notifications.filter((n) => !n.read).length;

  const filterTabs: { key: 'ALL' | 'UNREAD' | Severity; label: string }[] = [
    { key: 'ALL', label: `全部 ${state.notifications.length}` },
    { key: 'UNREAD', label: `未读 ${unreadCount}` },
    { key: 'INFO', label: '信息' },
    { key: 'WARN', label: '警告' },
    { key: 'ERROR', label: '错误' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex rounded border border-line overflow-hidden text-[11px]">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-2.5 py-1 ${filter === tab.key ? 'bg-gold/15 text-gold' : 'text-secondary hover:text-primary'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={markAllNotificationsRead}>
          <CheckCheck size={13} /> 全部已读
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState title="暂无通知" description="分红提醒、定投待确认、数据源异常会出现在这里（按 key 去重）" />
      ) : (
        <ul className="divide-y divide-line-soft">
          {list.map((n) => (
            <NotificationRow key={n.id} n={n} onRead={markNotificationRead} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({ n, onRead }: { n: Notification; onRead: (id: string) => void }) {
  return (
    <li
      className={`flex items-start gap-3 px-3 py-2.5 rounded-md ${n.read ? 'opacity-55' : 'bg-card/60'}`}
      onClick={() => !n.read && onRead(n.id)}
    >
      <Bell size={15} className={`mt-0.5 shrink-0 ${n.severity === 'ERROR' ? 'text-danger' : n.severity === 'WARN' ? 'text-warning' : 'text-declared'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-primary font-medium">{n.title}</span>
          <Badge variant={severityVariant[n.severity]}>{n.severity}</Badge>
          {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-gold" />}
        </div>
        <p className="text-[12px] text-secondary mt-0.5">{n.body}</p>
        <div className="text-[10px] text-disabled mt-1 font-mono">
          {n.createdAt.replace('T', ' ').slice(0, 16)} UTC · {n.type}
        </div>
      </div>
    </li>
  );
}

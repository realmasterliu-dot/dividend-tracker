import React, { useMemo, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Notification, NotificationType, Severity } from '@/types';
import { useData } from '@/store/DataContext';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

const severityVariant = { INFO: 'cyan', WARN: 'orange', ERROR: 'red' } as const;

export const notificationSeverityLabel: Record<Severity, string> = {
  INFO: '提醒',
  WARN: '注意',
  ERROR: '异常',
};

export const notificationTypeLabel: Record<NotificationType, string> = {
  DIVIDEND_PROPOSED: '分红预案',
  DIVIDEND_DECLARED: '分红宣告',
  RECORD_DATE_CLOSE: '登记日临近',
  EX_DATE: '除息日',
  PAY_DATE: '派息日',
  DCA_PENDING: '定投待确认',
  SOURCE_ERROR: '数据源异常',
  CORP_ACTION: '公司行动',
  TAX_BRACKET: '税档变化',
  DATA_STALE: '数据更新延迟',
};

export function formatNotificationTime(createdAt: string): string {
  const match = createdAt.match(/^(\d{4})-(\d{2})-(\d{2})(?:T| )(\d{2}):(\d{2})/);
  if (match) return `${match[1]}年${Number(match[2])}月${Number(match[3])}日 ${match[4]}:${match[5]}`;
  const dateOnly = createdAt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[1]}年${Number(dateOnly[2])}月${Number(dateOnly[3])}日`;
  return createdAt;
}

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
    { key: 'INFO', label: '提醒' },
    { key: 'WARN', label: '注意' },
    { key: 'ERROR', label: '异常' },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex w-max overflow-hidden rounded-lg border border-line text-[12px]">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={filter === tab.key}
                onClick={() => setFilter(tab.key)}
                className={`min-h-11 shrink-0 px-3 transition-colors sm:min-h-9 ${filter === tab.key ? 'bg-gold/15 text-gold' : 'text-secondary hover:text-primary'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 self-end sm:min-h-9"
          disabled={unreadCount === 0}
          onClick={markAllNotificationsRead}
        >
          <CheckCheck size={15} /> 全部标为已读
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState title="暂无通知" description="分红日程、定投和数据异常提醒会显示在这里。" />
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
    <li className="rounded-lg">
      <button
        type="button"
        disabled={n.read}
        aria-label={n.read ? `${n.title}，已读` : `${n.title}，点按标为已读`}
        className={`flex min-h-16 w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors ${n.read ? 'cursor-default opacity-55' : 'bg-card/60 hover:bg-card-hover active:bg-card-hover'}`}
        onClick={() => onRead(n.id)}
      >
        <Bell size={17} className={`mt-0.5 shrink-0 ${n.severity === 'ERROR' ? 'text-danger' : n.severity === 'WARN' ? 'text-warning' : 'text-declared'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium text-primary">{n.title}</span>
            <Badge variant={severityVariant[n.severity]}>{notificationSeverityLabel[n.severity]}</Badge>
            {!n.read && <span aria-label="未读" className="h-1.5 w-1.5 rounded-full bg-gold" />}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-secondary">{n.body}</p>
          <div className="mt-1.5 text-[10px] text-disabled">
            <time dateTime={n.createdAt}>{formatNotificationTime(n.createdAt)}</time>
            <span aria-hidden="true"> · </span>
            {notificationTypeLabel[n.type]}
          </div>
        </div>
      </button>
    </li>
  );
}

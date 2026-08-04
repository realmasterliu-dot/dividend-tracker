import React from 'react';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';

/** 通知中心页 */
export function NotificationsPage() {
  return (
    <div className="p-4">
      <div className="mb-3">
        <h2 className="text-[18px] font-bold text-primary">通知中心</h2>
        <p className="text-[12px] text-secondary mt-0.5">
          分红提醒 / 定投待确认 / 数据源异常 · 按 key 去重（重跑不重复推送）
        </p>
      </div>
      <NotificationCenter />
    </div>
  );
}

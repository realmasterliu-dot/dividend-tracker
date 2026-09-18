import React from 'react';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';

/** 通知中心页 */
export function NotificationsPage() {
  return (
    <div className="p-4 pb-24 md:pb-4">
      <div className="mb-3">
        <h2 className="text-[18px] font-bold text-primary">通知中心</h2>
        <p className="text-[12px] text-secondary mt-0.5">
          集中查看分红日程、定投确认和数据异常提醒。
        </p>
      </div>
      <NotificationCenter />
    </div>
  );
}

import React from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/** 空态 / 无分红资产显示 '—' */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <Inbox size={28} className="text-disabled mb-2" />
      <p className="text-[13px] text-secondary">{title}</p>
      {description && <p className="text-[11px] text-disabled mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** 不可分红资产的占位：显示 '—'（绝不显示 ¥0.00） */
export function Dash() {
  return <span className="num text-disabled">—</span>;
}

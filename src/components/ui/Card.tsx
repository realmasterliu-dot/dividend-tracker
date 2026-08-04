import React from 'react';
import clsx from 'clsx';

interface CardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  padding?: boolean;
}

/** 卡片容器（#161C26 底、#1F2733 边框） */
export function Card({ title, subtitle, action, children, className, bodyClassName, padding = true }: CardProps) {
  return (
    <section className={clsx('panel overflow-hidden', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-line-soft">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-primary tracking-wide truncate">{title}</h3>
            {subtitle && <p className="text-[11px] text-secondary mt-0.5 truncate">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={clsx(padding && 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

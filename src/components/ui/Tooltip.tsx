import React from 'react';
import clsx from 'clsx';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  wide?: boolean;
}

/** 悬停说明（计算口径、免责声明） */
export function Tooltip({ content, children, side = 'top', className, wide }: TooltipProps) {
  const position =
    side === 'bottom'
      ? 'top-full mt-1.5 left-1/2 -translate-x-1/2'
      : side === 'left'
        ? 'right-full mr-1.5 top-1/2 -translate-y-1/2'
        : side === 'right'
          ? 'left-full ml-1.5 top-1/2 -translate-y-1/2'
          : 'bottom-full mb-1.5 left-1/2 -translate-x-1/2';

  return (
    <span className={clsx('relative inline-flex group', className)}>
      {children}
      <span
        role="tooltip"
        className={clsx(
          'pointer-events-none absolute z-40 hidden group-hover:block',
          position,
          wide ? 'w-64' : 'w-48',
          'rounded-md border border-line bg-[#0E1420] px-2.5 py-2 text-[11px] leading-relaxed text-secondary shadow-glow',
        )}
      >
        {content}
      </span>
    </span>
  );
}

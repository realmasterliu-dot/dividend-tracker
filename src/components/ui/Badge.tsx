import React from 'react';
import clsx from 'clsx';

export type BadgeVariant =
  | 'gray'
  | 'gold'
  | 'cyan'
  | 'orange'
  | 'red'
  | 'green'
  | 'prediction'
  | 'blue';

const styles: Record<BadgeVariant, string> = {
  gray: 'bg-[#232C3B] text-secondary border border-line',
  gold: 'bg-gold-soft text-gold border border-gold/30',
  cyan: 'bg-declared/10 text-declared border border-declared/30',
  orange: 'bg-warning/10 text-warning border border-warning/30',
  red: 'bg-danger/10 text-danger border border-danger/30',
  green: 'bg-healthy/10 text-healthy border border-healthy/30',
  prediction: 'bg-prediction/15 text-[#8B96A8] border border-dashed border-prediction',
  blue: 'bg-up-soft text-up border border-up/30',
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  title?: string;
}

export function Badge({ children, variant = 'gray', className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium leading-none whitespace-nowrap',
        styles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

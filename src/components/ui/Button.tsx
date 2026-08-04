import React from 'react';
import clsx from 'clsx';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'gold';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-declared text-[#06222A] hover:bg-[#29D3E8] font-semibold',
  outline: 'border border-line text-primary hover:bg-card-hover',
  ghost: 'text-secondary hover:text-primary hover:bg-card-hover',
  danger: 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20',
  gold: 'bg-gold text-[#201500] hover:bg-[#FFCE3D] font-semibold',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  full?: boolean;
}

export function Button({ variant = 'outline', size = 'md', full, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2 py-1 text-[12px]' : 'px-3 py-1.5 text-[13px]',
        variants[variant],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

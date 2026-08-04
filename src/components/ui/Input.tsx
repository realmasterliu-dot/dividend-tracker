import React from 'react';
import clsx from 'clsx';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export function Input({ label, hint, className, id, ...rest }: InputProps) {
  const inputId = id ?? label;
  return (
    <label className="block" htmlFor={inputId}>
      {label && (
        <span className="block text-[12px] text-secondary mb-1">{label}</span>
      )}
      <input
        id={inputId}
        className={clsx(
          'w-full rounded-md bg-[#0E1420] border border-line px-2.5 py-1.5 text-[13px] text-primary placeholder:text-disabled focus:outline-none focus:border-declared/60 transition-colors',
          'font-mono tabular-nums',
          className,
        )}
        {...rest}
      />
      {hint && <span className="block text-[11px] text-disabled mt-1">{hint}</span>}
    </label>
  );
}

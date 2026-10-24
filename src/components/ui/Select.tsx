import React from 'react';
import clsx from 'clsx';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
  hint?: string;
}

export function Select({ label, options, hint, className, ...rest }: SelectProps) {
  return (
    <label className="block">
      {label && <span className="block text-[12px] text-secondary mb-1">{label}</span>}
      <select
        className={clsx(
          'min-h-11 w-full rounded-lg bg-[#0E1420] border border-line px-3 py-2.5 text-[16px] sm:text-[13px] text-primary focus:outline-none focus:border-declared/60 transition-colors appearance-none',
          className,
        )}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-card">
            {opt.label}
          </option>
        ))}
      </select>
      {hint && <span className="block text-[11px] text-disabled mt-1">{hint}</span>}
    </label>
  );
}

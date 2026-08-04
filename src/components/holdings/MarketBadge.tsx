import React from 'react';
import { Market } from '@/types';
import clsx from 'clsx';

const marketConfig: Record<Market, { label: string; className: string }> = {
  A_SHARE: { label: 'A股', className: 'bg-danger/12 text-danger border-danger/30' },
  HK: { label: 'HK', className: 'bg-declared/12 text-declared border-declared/30' },
  US: { label: 'US', className: 'bg-up-soft text-up border-up/30' },
  FUND: { label: '基金', className: 'bg-warning/12 text-warning border-warning/30' },
  CRYPTO: { label: 'CRYPTO', className: 'bg-[#9C27B0]/12 text-[#CE93D8] border-[#9C27B0]/30' },
  GOLD: { label: 'GOLD', className: 'bg-gold-soft text-gold border-gold/30' },
};

/** 市场徽章（A股/HK/US/基金/CRYPTO/GOLD） */
export function MarketBadge({ market, size = 'sm' }: { market: Market; size?: 'xs' | 'sm' }) {
  const cfg = marketConfig[market];
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded border font-medium leading-none whitespace-nowrap',
        cfg.className,
        size === 'xs' ? 'px-1 py-[2px] text-[9px]' : 'px-1.5 py-0.5 text-[10px]',
      )}
    >
      {cfg.label}
    </span>
  );
}

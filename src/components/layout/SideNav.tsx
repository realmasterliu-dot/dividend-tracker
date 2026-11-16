import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { BookOpen, CalendarDays, Home, Plus, Settings } from 'lucide-react';
import { useData } from '@/store/DataContext';

interface SideNavProps {
  onRecord?: () => void;
}

const navItems = [
  { to: '/', label: '首页', icon: Home, matches: (path: string) => path === '/' },
  {
    to: '/holdings',
    label: '账本',
    icon: BookOpen,
    matches: (path: string) =>
      path.startsWith('/holdings') ||
      path.startsWith('/ledger') ||
      path.startsWith('/transactions') ||
      path.startsWith('/instruments'),
  },
  { to: '/calendar', label: '日历', icon: CalendarDays, matches: (path: string) => path.startsWith('/calendar') },
  {
    to: '/settings',
    label: '更多',
    icon: Settings,
    matches: (path: string) =>
      path.startsWith('/settings') || path.startsWith('/dca') || path.startsWith('/notifications'),
  },
] as const;

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-warning px-1 text-center text-[9px] font-semibold leading-4 text-page">
      {count > 9 ? '9+' : count}
    </span>
  );
}

export function SideNav({ onRecord }: SideNavProps) {
  const { pathname } = useLocation();
  const { state } = useData();
  const ledgerCount = state.transactions.filter((item) => item.status === 'PENDING').length;
  const moreCount = state.notifications.filter((item) => !item.read).length;

  const badgeFor = (to: string) => {
    if (to === '/holdings') return ledgerCount;
    if (to === '/settings') return moreCount;
    return 0;
  };

  return (
    <>
      <nav aria-label="主要导航" className="hidden h-12 items-center gap-1 px-5 md:flex lg:px-8">
        {navItems.map((item) => {
          const active = item.matches(pathname);
          const count = badgeFor(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'relative flex h-9 items-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70',
                active ? 'bg-card text-primary' : 'text-secondary hover:bg-card/60 hover:text-primary',
              )}
            >
              <item.icon size={16} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
              <span>{item.label}</span>
              {count > 0 && (
                <span className="min-w-[17px] rounded-full bg-warning px-1 text-center text-[9px] font-semibold leading-[17px] text-page">
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <nav
        aria-label="手机导航"
        className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(68px+env(safe-area-inset-bottom))] grid-cols-5 border-t border-line bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        {navItems.slice(0, 2).map((item) => {
          const active = item.matches(pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'relative flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-md text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70',
                active ? 'text-gold' : 'text-secondary',
              )}
            >
              <item.icon size={21} strokeWidth={active ? 2.3 : 1.8} aria-hidden="true" />
              <span>{item.label}</span>
              <CountBadge count={badgeFor(item.to)} />
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onRecord}
          aria-label="记一笔"
          className="group flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-gold focus-visible:outline-none"
        >
          <span className="-mt-5 grid h-12 w-12 place-items-center rounded-full border-4 border-page bg-gold text-page shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-transform group-active:scale-95 group-focus-visible:ring-2 group-focus-visible:ring-gold group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-page">
            <Plus size={23} strokeWidth={2.5} aria-hidden="true" />
          </span>
          <span>记一笔</span>
        </button>

        {navItems.slice(2).map((item) => {
          const active = item.matches(pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'relative flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-md text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70',
                active ? 'text-gold' : 'text-secondary',
              )}
            >
              <item.icon size={21} strokeWidth={active ? 2.3 : 1.8} aria-hidden="true" />
              <span>{item.label}</span>
              <CountBadge count={badgeFor(item.to)} />
            </Link>
          );
        })}
      </nav>
    </>
  );
}

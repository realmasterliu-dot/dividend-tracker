import React from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard,
  Table2,
  CalendarDays,
  Receipt,
  Repeat,
  Bell,
  Settings as SettingsIcon,
  TrendingUp,
} from 'lucide-react';
import { useData } from '@/store/DataContext';
import { usePortfolio } from '@/lib/hooks/usePortfolio';

const navItems = [
  { to: '/', label: '看板', icon: LayoutDashboard, end: true },
  { to: '/holdings', label: '持仓', icon: Table2 },
  { to: '/calendar', label: '分红日历', icon: CalendarDays },
  { to: '/transactions', label: '流水', icon: Receipt },
  { to: '/dca', label: '定投', icon: Repeat },
  { to: '/notifications', label: '通知', icon: Bell },
  { to: '/settings', label: '设置', icon: SettingsIcon },
];

export function SideNav() {
  const { state } = useData();
  const { pendingTxCount } = usePortfolio();
  const unread = state.notifications.filter((n) => !n.read).length;

  return (
    <aside className="w-[180px] shrink-0 border-r border-line bg-card/60 flex flex-col">
      <div className="px-4 py-4 flex items-center gap-2 border-b border-line">
        <TrendingUp size={18} className="text-gold" />
        <div>
          <div className="text-[13px] font-bold text-primary leading-none">股息追踪</div>
          <div className="text-[10px] text-disabled mt-1">DIVIDEND TRACKER</div>
        </div>
      </div>
      <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 px-4 py-2 text-[13px] transition-colors',
                isActive
                  ? 'text-primary bg-card-hover border-r-2 border-gold'
                  : 'text-secondary hover:text-primary hover:bg-card-hover',
              )
            }
          >
            <item.icon size={15} />
            <span>{item.label}</span>
            {item.to === '/transactions' && pendingTxCount > 0 && (
              <span className="ml-auto text-[10px] bg-warning/15 text-warning rounded px-1.5 py-0.5 font-mono">
                {pendingTxCount}
              </span>
            )}
            {item.to === '/notifications' && unread > 0 && (
              <span className="ml-auto text-[10px] bg-danger/15 text-danger rounded px-1.5 py-0.5 font-mono">
                {unread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-line text-[10px] text-disabled leading-relaxed">
        演示数据 · 本地存储
        <br />
        纯前端 SPA · v1.0
      </div>
    </aside>
  );
}

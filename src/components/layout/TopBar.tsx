import React from 'react';
import { Cloud, CloudOff, LoaderCircle, Plus, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';

interface TopBarProps {
  onRecord?: () => void;
}

export function TopBar({ onRecord }: TopBarProps) {
  const { hydration, cloudSync } = useData();
  const { status: authStatus } = useAuth();

  const status = (() => {
    if (authStatus === 'ERROR') {
      return { label: '连接失败', icon: TriangleAlert, className: 'text-danger' };
    }
    if (cloudSync === 'ERROR') {
      return { label: '保存失败', icon: TriangleAlert, className: 'text-danger' };
    }
    if (authStatus === 'CHECKING' || cloudSync === 'LOADING' || hydration.status === 'LOADING') {
      return {
        label: authStatus === 'CHECKING' ? '正在连接' : cloudSync === 'LOADING' ? '正在保存' : '更新行情',
        icon: LoaderCircle,
        className: 'text-secondary',
      };
    }
    if (cloudSync === 'SYNCED') {
      return { label: '已保存', icon: Cloud, className: 'text-healthy' };
    }
    if (authStatus === 'SIGNED_OUT') {
      return { label: '未登录', icon: CloudOff, className: 'text-warning' };
    }
    return { label: '仅本机', icon: CloudOff, className: 'text-disabled' };
  })();

  const StatusIcon = status.icon;

  return (
    <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-5 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-gold/30 bg-gold/10 text-sm font-bold text-gold" aria-hidden="true">
          息
        </span>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold leading-tight text-primary">股息账本</div>
          <div className="hidden text-[10px] leading-tight text-disabled sm:block">资产与分红，一眼看懂</div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          to="/settings"
          className={`flex min-h-9 items-center gap-1.5 rounded-md px-1.5 text-[11px] hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 ${status.className}`}
          aria-label={`保存状态：${status.label}，打开设置`}
          title="查看保存与账户设置"
        >
          <StatusIcon
            size={14}
            className={
              authStatus === 'CHECKING' || cloudSync === 'LOADING' || hydration.status === 'LOADING'
                ? 'animate-spin'
                : ''
            }
            aria-hidden="true"
          />
          <span>{status.label}</span>
        </Link>

        <button
          type="button"
          onClick={onRecord}
          className="hidden h-9 items-center gap-1.5 rounded-md bg-gold px-3.5 text-[12px] font-semibold text-page transition-colors hover:bg-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-page md:flex"
        >
          <Plus size={16} aria-hidden="true" />
          记一笔
        </button>
      </div>
    </div>
  );
}

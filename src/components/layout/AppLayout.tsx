import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Cloud, RefreshCw } from 'lucide-react';
import { TransactionForm } from '@/components/transactions/TransactionForm';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';

/**
 * App shell: the same quick-entry action is available from the desktop header
 * and the mobile bottom navigation. The actual form stays mounted here so a
 * record can be added without leaving the page the user is reading.
 */
export function AppLayout() {
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const { status: authStatus, error: authError } = useAuth();
  const { cloudHydrating, cloudSyncError } = useData();
  const privacyLocked = authStatus === 'CHECKING' || authStatus === 'ERROR' || cloudHydrating;
  const blockedByError = authStatus === 'ERROR' || Boolean(cloudSyncError && cloudHydrating);
  const openQuickEntry = () => setQuickEntryOpen(true);

  useEffect(() => {
    const handleQuickEntry = () => setQuickEntryOpen(true);
    window.addEventListener('dividend-tracker:quick-entry', handleQuickEntry);
    return () => window.removeEventListener('dividend-tracker:quick-entry', handleQuickEntry);
  }, []);

  return (
    <div className="h-full min-h-0 flex flex-col bg-page">
      <header className="relative z-30 shrink-0 border-b border-line bg-page">
        {!privacyLocked && (
          <>
            <TopBar onRecord={openQuickEntry} />
            <SideNav onRecord={openQuickEntry} />
          </>
        )}
      </header>

      <main
        id="main-content"
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0"
      >
        {privacyLocked ? (
          <div className="grid min-h-full place-items-center p-6" role="status" aria-live="polite">
            <div className="text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gold/10 text-gold">
                {blockedByError
                  ? <Cloud size={21} aria-hidden="true" />
                  : <Cloud size={21} className="animate-pulse" aria-hidden="true" />}
              </span>
              <p className="mt-3 text-[13px] font-medium text-primary">
                {blockedByError ? '暂时无法确认你的账本' : '正在打开你的账本'}
              </p>
              <p className="mx-auto mt-1 max-w-xs text-[11px] leading-5 text-secondary">
                {blockedByError
                  ? (authError ?? cloudSyncError ?? '账号连接遇到问题。你的本机待同步记录没有被删除。')
                  : '确认账号后再显示个人数据'}
              </p>
              {blockedByError && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mx-auto mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-[12px] text-primary"
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  重新连接
                </button>
              )}
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      <TransactionForm
        open={quickEntryOpen && !privacyLocked}
        onClose={() => setQuickEntryOpen(false)}
      />
    </div>
  );
}

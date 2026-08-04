import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';

/** 页面级懒加载（architecture.md §5.4 路由表） */
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const HoldingsPage = lazy(() => import('@/pages/HoldingsPage').then((m) => ({ default: m.HoldingsPage })));
const CalendarPage = lazy(() => import('@/pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const InstrumentPage = lazy(() => import('@/pages/InstrumentPage').then((m) => ({ default: m.InstrumentPage })));
const TransactionsPage = lazy(() => import('@/pages/TransactionsPage').then((m) => ({ default: m.TransactionsPage })));
const DcaPage = lazy(() => import('@/pages/DcaPage').then((m) => ({ default: m.DcaPage })));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SubmissionStatusPage = lazy(() =>
  import('@/pages/SubmissionStatusPage').then((m) => ({ default: m.SubmissionStatusPage })),
);

function PageFallback() {
  return (
    <div className="p-6">
      <div className="skeleton h-6 w-48 mb-3" />
      <div className="skeleton h-40 w-full" />
    </div>
  );
}

/**
 * 路由表：HashRouter（静态托管零配置）
 * /instruments/:id 无效 id 由 InstrumentDetail 内重定向回 /holdings
 */
export function AppRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/holdings" element={<HoldingsPage />} />
          <Route path="/instruments/:id" element={<InstrumentPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/dca" element={<DcaPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="/submission-status" element={<SubmissionStatusPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

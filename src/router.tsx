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
    <Routes>
      <Route element={<AppLayout />}>
        <Route
          path="/"
          element={<Suspense fallback={<PageFallback />}><DashboardPage /></Suspense>}
        />
        <Route
          path="/holdings"
          element={<Suspense fallback={<PageFallback />}><HoldingsPage /></Suspense>}
        />
        <Route
          path="/ledger"
          element={<Navigate to="/holdings" replace />}
        />
        <Route
          path="/instruments/:id"
          element={<Suspense fallback={<PageFallback />}><InstrumentPage /></Suspense>}
        />
        <Route
          path="/calendar"
          element={<Suspense fallback={<PageFallback />}><CalendarPage /></Suspense>}
        />
        <Route
          path="/transactions"
          element={<Suspense fallback={<PageFallback />}><TransactionsPage /></Suspense>}
        />
        <Route
          path="/dca"
          element={<Suspense fallback={<PageFallback />}><DcaPage /></Suspense>}
        />
        <Route
          path="/notifications"
          element={<Suspense fallback={<PageFallback />}><NotificationsPage /></Suspense>}
        />
        <Route
          path="/settings"
          element={<Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

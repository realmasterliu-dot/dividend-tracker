import React from 'react';
import { HashRouter } from 'react-router-dom';
import { AppProvider } from '@/store/AppContext';
import { AppRoutes } from '@/router';

/** 根组件：AppProvider + HashRouter + 路由表 */
export function App() {
  return (
    <AppProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AppProvider>
  );
}

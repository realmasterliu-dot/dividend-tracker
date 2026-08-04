import React from 'react';
import { Outlet } from 'react-router-dom';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';

/** 布局骨架：TopBar + SideNav + Outlet（architecture.md §2.10） */
export function AppLayout() {
  return (
    <div className="h-full flex flex-col bg-page">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <SideNav />
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

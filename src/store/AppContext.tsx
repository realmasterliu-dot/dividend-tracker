import React from 'react';
import { SettingsProvider } from './SettingsContext';
import { DataProvider } from './DataContext';

/** 根 Provider：SettingsProvider + DataProvider（architecture.md §5.1） */
export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <DataProvider>{children}</DataProvider>
    </SettingsProvider>
  );
}

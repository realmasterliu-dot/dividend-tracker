import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { AppSettings } from '@/types';
import { seedSettings } from '@/data/seed/settings.seed';
import { useLocalStorage } from './useLocalStorage';
import { applySettingsToDom } from '@/styles/theme';

interface SettingsContextValue {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const STORAGE_KEY = 'dt:settings:v1';

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useLocalStorage<AppSettings>(STORAGE_KEY, seedSettings);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, [setSettings]);

  const reset = useCallback(() => {
    setSettings(seedSettings);
  }, [setSettings]);

  // 主题注入：涨跌色三档 + 基础色（切换无需重渲染整树）
  useEffect(() => {
    applySettingsToDom(settings);
  }, [settings]);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, update, reset }),
    [settings, update, reset],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

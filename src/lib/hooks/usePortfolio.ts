import { useMemo } from 'react';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { derivePortfolio, PortfolioDerived } from '@/store/selectors';

/** 组合级派生：总资产/回报拆解/双口径股息率/XIRR-TWR-YOC/待办（useMemo 缓存） */
export function usePortfolio(): PortfolioDerived {
  const { state } = useData();
  const { settings } = useSettings();
  return useMemo(() => derivePortfolio(state, settings), [state, settings]);
}

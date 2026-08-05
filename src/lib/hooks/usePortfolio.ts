import { useMemo } from 'react';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { derivePortfolio, PortfolioDerived } from '@/store/selectors';

/**
 * 组合级派生：总资产/回报拆解/双口径股息率/XIRR-TWR-YOC/待办。
 *
 * 两级缓存：
 * - 组件内 useMemo：同一组件重渲染时不重复取值；
 * - derivePortfolio 内的模块级记忆化：**跨组件**共享同一次计算 ——
 *   约 10 个组件各自调用本 hook，useMemo 彼此隔离，仅靠它会让整条派生链路
 *   在一次页面加载里重复跑 8 次以上，故真正的去重发生在 selectors 层。
 */
export function usePortfolio(): PortfolioDerived {
  const { state } = useData();
  const { settings } = useSettings();
  return useMemo(() => derivePortfolio(state, settings), [state, settings]);
}

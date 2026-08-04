import { useEffect, useState } from 'react';

/**
 * 版本化 localStorage hook（architecture.md §5.3）
 * key 含版本（dt:state:v1 / dt:settings:v1）；schema 变更时 bump 版本自动重置。
 */
export function useLocalStorage<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as T;
        return parsed;
      }
    } catch {
      // 解析失败 → 重置为初始值
    }
    return initial;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 存储满/隐私模式 → 静默降级（内存态仍可用）
    }
  }, [key, value]);

  return [value, setValue];
}

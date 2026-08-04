import { AppSettings } from '@/types';
import { CSS_VARS, COLOR_SCHEMES } from './tokens';

/**
 * 主题注入：把 design token 写入 <html> 的 CSS 变量。
 * - 基础色：一次注入，全局稳定
 * - 涨跌色：按 settings.colorScheme 三档切换（data-scheme + 变量双写）
 * 切换无需重渲染整树。
 */
export function applySettingsToDom(settings: AppSettings): void {
  const root = document.documentElement;
  if (!root) return;

  for (const [key, value] of Object.entries(CSS_VARS)) {
    root.style.setProperty(key, value);
  }

  const scheme = COLOR_SCHEMES[settings.colorScheme.toLowerCase() as keyof typeof COLOR_SCHEMES] ?? COLOR_SCHEMES.cn;
  root.dataset.scheme = settings.colorScheme.toLowerCase();
  root.style.setProperty('--scheme-up', scheme.up);
  root.style.setProperty('--scheme-down', scheme.down);
  root.style.setProperty('--scheme-up-soft', scheme.upSoft);
  root.style.setProperty('--scheme-down-soft', scheme.downSoft);
  root.style.setProperty('--scheme-up-strong', scheme.upStrong);
  root.style.setProperty('--scheme-down-strong', scheme.downStrong);
}

/** 首屏引导：从 localStorage 读取设置立即应用（避免主题闪烁） */
export function initThemeFromStorage(): void {
  try {
    const raw = window.localStorage.getItem('dt:settings:v1');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      applySettingsToDom({
        colorScheme: parsed.colorScheme ?? 'CN',
        baseCurrency: parsed.baseCurrency ?? 'CNY',
        displayCurrency: parsed.displayCurrency ?? 'CNY',
        w8benFilled: parsed.w8benFilled ?? false,
        fxNeutralMode: parsed.fxNeutralMode ?? false,
        annualIncomeTarget: parsed.annualIncomeTarget,
        notificationChannels: parsed.notificationChannels ?? {},
        quietHours: parsed.quietHours,
        stalenessThresholdHours: parsed.stalenessThresholdHours ?? 48,
      });
      return;
    }
  } catch {
    // ignore
  }
  applySettingsToDom({
    colorScheme: 'CN',
    baseCurrency: 'CNY',
    displayCurrency: 'CNY',
    w8benFilled: false,
    fxNeutralMode: false,
    annualIncomeTarget: undefined,
    notificationChannels: {},
    quietHours: undefined,
    stalenessThresholdHours: 48,
  });
}

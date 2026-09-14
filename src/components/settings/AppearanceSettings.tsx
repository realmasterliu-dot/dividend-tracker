import React from 'react';
import { useSettings } from '@/store/SettingsContext';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';

/** 涨跌色三档 + 显示币种（PRD §8.2.3） */
export function AppearanceSettings() {
  const { settings, update } = useSettings();

  return (
    <Card title="外观与显示" bodyClassName="p-4 space-y-4">
      <Select
        label="涨跌色方案（全局统一，不按市场切换）"
        value={settings.colorScheme}
        onChange={(e) => update({ colorScheme: e.target.value as typeof settings.colorScheme })}
        options={[
          { value: 'CN', label: '中国习惯（红涨绿跌）' },
          { value: 'INTL', label: '国际习惯（绿涨红跌）' },
          { value: 'COLORBLIND', label: '色盲友好（蓝涨橙跌）' },
        ]}
        hint="全站统一使用同一套颜色，跨市场查看时更容易理解。"
      />
      <Select
        label="显示币种（与本位币解耦，可随时切换）"
        value={settings.displayCurrency}
        onChange={(e) => update({ displayCurrency: e.target.value as typeof settings.displayCurrency })}
        options={[
          { value: 'CNY', label: '人民币 ¥' },
          { value: 'USD', label: '美元 $' },
        ]}
      />
      <div className="flex items-center gap-4 pt-2 border-t border-line-soft">
        <div className="text-[12px] text-secondary">涨跌预览</div>
        <span className="num text-up bg-up-soft px-2 py-1 rounded text-[13px]">+2.45%</span>
        <span className="num text-down bg-down-soft px-2 py-1 rounded text-[13px]">-1.20%</span>
      </div>
    </Card>
  );
}

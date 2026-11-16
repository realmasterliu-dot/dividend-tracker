import React from 'react';
import { useSettings } from '@/store/SettingsContext';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useData } from '@/store/DataContext';

/** W-8BEN 状态 + 本位币 + 汇率中性模式（PRD §5.9） */
export function TaxSettings() {
  const { settings, update } = useSettings();
  const { state } = useData();
  const baseCurrencyLocked =
    state.transactions.length > 0 ||
    state.dividends.some(
      (event) =>
        event.manual ||
        event.actualReceived !== undefined ||
        event.taxWithheldOverride !== undefined,
    );

  return (
    <Card title="税务与币种口径" bodyClassName="p-4 space-y-4">
      {!settings.w8benFilled && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-[12px] text-warning flex items-center gap-2">
          ⚠ 美股预扣税率未确认，当前按 <b>30%</b> 保守估算（已填 W-8BEN 为 10%，相差 3 倍）
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] text-primary font-medium">美股 W-8BEN 状态</div>
          <div className="text-[11px] text-secondary mt-0.5">未提交=30% 预扣；已提交=10% 预扣；REIT/MLP 一律 30%</div>
        </div>
        <Select
          value={settings.w8benFilled ? 'true' : 'false'}
          onChange={(e) => update({ w8benFilled: e.target.value === 'true' })}
          options={[
            { value: 'false', label: '未填（30% 保守估算）' },
            { value: 'true', label: '已填 W-8BEN（10%）' },
          ]}
        />
      </div>
      <div className="pt-3 border-t border-line-soft">
        <Select
          label="记账本位币（⚠ 选定后难改，影响历史成本口径）"
          value={settings.baseCurrency}
          disabled={baseCurrencyLocked}
          onChange={(e) => update({ baseCurrency: e.target.value as 'CNY' | 'USD' })}
          options={[
            { value: 'CNY', label: '人民币 CNY' },
            { value: 'USD', label: '美元 USD' },
          ]}
          hint={
            baseCurrencyLocked
              ? '账本已有流水或实际分红，为保护历史成本口径，本位币已锁定'
              : '请在开始记账前选定；产生流水后将锁定'
          }
        />
      </div>
      <label className="flex items-center justify-between cursor-pointer pt-2 border-t border-line-soft">
        <div>
          <div className="text-[13px] text-primary font-medium">汇率中性模式</div>
          <div className="text-[11px] text-secondary mt-0.5">成本与市值均使用当前汇率，剥离汇兑损益，只看标的本身涨跌</div>
        </div>
        <input
          type="checkbox"
          checked={settings.fxNeutralMode}
          onChange={(e) => update({ fxNeutralMode: e.target.checked })}
          className="accent-declared w-4 h-4"
        />
      </label>
      {settings.fxNeutralMode && <Badge variant="blue">汇率中性模式已开启（Dashboard 常驻徽章）</Badge>}
    </Card>
  );
}

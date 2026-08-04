import React from 'react';
import { useSettings } from '@/store/SettingsContext';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatPercent, formatSigned } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Tooltip } from '@/components/ui/Tooltip';

/** 三段回报拆解：总回报 = 价格回报 + 分红回报(金) + 汇兑回报（PRD §7.4 强制展示） */
export function ReturnBreakdownCard() {
  const { settings } = useSettings();
  const { breakdown: bd } = usePortfolio();
  const { fmt } = useMoneyFmt();

  const rows = [
    { label: '价格回报', value: bd.price, pct: bd.pricePct, color: 'text-primary', note: '标的本身涨跌（当前汇率口径）' },
    { label: '分红回报', value: bd.dividend, pct: bd.dividendPct, color: 'text-gold', note: '已到账分红净额（金色=分红语义，非涨跌）' },
    { label: '汇兑回报', value: bd.fx, pct: bd.fxPct, color: 'text-secondary', note: '成本历史汇率 vs 当前汇率之差；汇率中性模式下恒为 0' },
  ];

  return (
    <Card title="回报拆解" subtitle="总回报 = 价格 + 分红 + 汇兑" bodyClassName="p-4">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="num text-[24px] font-bold text-primary">{formatSigned(bd.total, 0)}</span>
        <span className={`num text-[13px] ${bd.total >= 0 ? 'text-up' : 'text-down'}`}>
          ({formatPercent(bd.totalPct)})
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <Tooltip key={r.label} content={r.note} side="bottom" wide>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-secondary">{r.label}</span>
              <div className="flex items-center gap-3">
                <span className={`num ${r.color}`}>{fmt(r.value, 0)}</span>
                <span className={`num w-[64px] ${r.color}`}>{formatPercent(r.pct)}</span>
              </div>
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="mt-3 pt-2 border-t border-line-soft flex justify-between text-[11px] text-disabled">
        <span>三段之和 = 总回报</span>
        <span>{settings.fxNeutralMode ? '汇率中性模式已开启' : '会计口径（含汇兑）'}</span>
      </div>
    </Card>
  );
}

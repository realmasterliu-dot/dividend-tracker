import React, { useState } from 'react';
import { useSettings } from '@/store/SettingsContext';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatPctPlain } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Tooltip } from '@/components/ui/Tooltip';

/** 双口径股息率：整体 vs 收益型资产（PRD §6.2③ 关键设计） */
export function YieldDualCard() {
  const { metrics, totalMarketValue, ttmDividendTotal, positions } = usePortfolio();
  const { fmt } = useMoneyFmt();
  const [mode, setMode] = useState<'overall' | 'income'>('income');

  const eligibleMarketValue = positions
    .filter((p) => p.instrument.dividendEligible)
    .reduce((s, p) => s + p.marketValue, 0);

  const overall = totalMarketValue > 0 ? ttmDividendTotal / totalMarketValue : 0;
  const income = eligibleMarketValue > 0 ? ttmDividendTotal / eligibleMarketValue : 0;
  const active = mode === 'income' ? income : overall;

  return (
    <Card
      title="股息率 · 双口径"
      action={
        <div className="flex rounded border border-line overflow-hidden text-[11px]">
          {(['income', 'overall'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 transition-colors ${
                mode === m ? 'bg-gold/15 text-gold' : 'text-secondary hover:text-primary'
              }`}
            >
              {m === 'income' ? '收益型' : '整体'}
            </button>
          ))}
        </div>
      }
      bodyClassName="p-4"
    >
      <div className="num text-[36px] font-bold text-gold leading-none">{formatPctPlain(active)}</div>
      <div className="mt-2 space-y-1 text-[11px]">
        <Tooltip content="分母 = 总资产（含黄金/加密，会被拉低）" side="bottom">
          <div className="flex justify-between text-secondary">
            <span>整体股息率</span>
            <span className="num">{formatPctPlain(overall)}</span>
          </div>
        </Tooltip>
        <Tooltip content="分母 = 仅 dividend_eligible 资产（剔除黄金/加密等增值型）" side="bottom">
          <div className="flex justify-between text-secondary">
            <span>收益型股息率</span>
            <span className="num">{formatPctPlain(income)}</span>
          </div>
        </Tooltip>
        <div className="flex justify-between text-disabled pt-1 border-t border-line-soft">
          <span>分母口径</span>
          <span className="num">{fmt(mode === 'income' ? eligibleMarketValue : totalMarketValue, 0)}</span>
        </div>
      </div>
    </Card>
  );
}

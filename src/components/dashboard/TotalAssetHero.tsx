import React from 'react';
import { useSettings } from '@/store/SettingsContext';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatPercent, formatSigned } from '@/lib/format';
import { Tooltip } from '@/components/ui/Tooltip';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';

/** 总资产大数字（48-56px）+ 当日涨跌 + 币种切换 + 混合口径提示 */
export function TotalAssetHero() {
  const { settings, update } = useSettings();
  const { totalMarketValue, positions, totalCostValue, unrealizedPnl, ttmDividendTotal } = usePortfolio();
  const { fmt, symbol } = useMoneyFmt();

  const dayChange = positions.reduce((s, p) => {
    const change = (p.marketPrice - p.prevPrice) * p.totalQuantity * p.fxRate;
    return s + change;
  }, 0);
  const prevTotal = totalMarketValue - dayChange;
  const dayChangePct = prevTotal > 0 ? dayChange / prevTotal : 0;
  const positive = dayChange >= 0;

  const fundCount = positions.filter((p) => p.instrument.market === 'FUND').length;
  const fundNavDates = positions
    .filter((p) => p.instrument.market === 'FUND' && p.navDate)
    .map((p) => p.navDate!.slice(5));

  const toggleCurrency = () => {
    update({ displayCurrency: settings.displayCurrency === 'CNY' ? 'USD' : 'CNY' });
  };

  return (
    <Card bodyClassName="p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[12px] text-secondary mb-1">
            <span>总资产</span>
            {fundCount > 0 && (
              <Tooltip content={`含 ${fundCount} 只基金按净值日计（${fundNavDates.join(' / ')}）`} side="bottom">
                <Badge variant="cyan">含基金 T+1 净值</Badge>
              </Tooltip>
            )}
            {settings.fxNeutralMode && <Badge variant="blue">汇率中性模式</Badge>}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="num text-hero text-primary font-bold tracking-tight">
              {fmt(totalMarketValue, 0)}
            </span>
            <button
              onClick={toggleCurrency}
              className="text-[11px] text-secondary hover:text-declared transition-colors border border-line rounded px-1.5 py-0.5"
              title="切换显示币种（与本位币解耦）"
            >
              {symbol} {settings.displayCurrency === 'CNY' ? 'CNY' : 'USD'} ⇄
            </button>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[12px]">
            <span className={`num ${positive ? 'text-up' : 'text-down'}`}>
              {formatSigned(dayChange, 0)} ({formatPercent(dayChangePct)})
            </span>
            <span className="text-disabled">今日</span>
            <span className="num text-secondary">成本 {fmt(totalCostValue, 0)}</span>
            <span className={`num ${unrealizedPnl >= 0 ? 'text-up' : 'text-down'}`}>
              浮盈 {formatSigned(unrealizedPnl, 0)}
            </span>
          </div>
        </div>
        <div className="text-right text-[11px] text-disabled leading-relaxed">
          <div className="text-gold font-medium">被动收入 · 近12个月</div>
          <div className="num text-gold text-[18px]">{fmt(ttmDividendTotal, 0)}</div>
        </div>
      </div>
    </Card>
  );
}

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { selectTickerItems } from '@/store/selectors';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { formatNumber, formatPercent } from '@/lib/format';
import { MarketBadge } from '@/components/holdings/MarketBadge';

/** 顶部横向滚动行情条（交易所风格标志性元素，双份内容无缝滚动） */
export function TickerTape() {
  const { state } = useData();
  const { positions } = usePortfolio();
  const items = useMemo(() => selectTickerItems(state, positions), [state, positions]);

  const renderItems = (keyPrefix: string) => (
    <div key={keyPrefix} className="flex items-center gap-5 pr-5">
      {items.map((item) => {
        const positive = item.changePct >= 0;
        return (
          <div key={`${keyPrefix}-${item.symbol}`} className="flex items-center gap-1.5 whitespace-nowrap text-[11px]">
            <span className="text-secondary font-medium">{item.symbol}</span>
            <MarketBadge market={item.market} size="xs" />
            <span className="num text-primary">{formatNumber(item.price, item.market === 'CRYPTO' ? 2 : 2)}</span>
            <span className={`num ${positive ? 'text-up' : 'text-down'}`}>{formatPercent(item.changePct)}</span>
          </div>
        );
      })}
    </div>
  );

  if (items.length === 0) return <div className="flex-1" />;

  return (
    <div className="flex-1 min-w-0 overflow-hidden no-scrollbar">
      <div className="animate-ticker flex w-max">
        {renderItems('a')}
        {renderItems('b')}
      </div>
    </div>
  );
}

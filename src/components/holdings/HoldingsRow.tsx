import React, { useMemo } from 'react';
import { Position } from '@/types';
import { Sparkline } from '@/components/charts/Sparkline';
import { useData } from '@/store/DataContext';
import { todayISO } from '@/lib/clock';

/** 可展开行（TaxLot 明细 + 税档）；渲染于 Table 的 expandable 区域 */
export function HoldingsRowDetail({ position }: { position: Position }) {
  const { state } = useData();

  const priceSeries = useMemo(() => {
    return state.prices
      .filter((p) => p.instrumentId === position.instrumentId)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)
      .map((p) => p.price);
  }, [state.prices, position.instrumentId]);

  return (
    <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="text-[11px] text-secondary font-medium mb-2">TaxLot 批次明细（FIFO）</div>
        <table className="tbl text-[11px]">
          <thead>
            <tr>
              <th>买入日</th>
              <th className="text-right">剩余数量</th>
              <th className="text-right">成本价</th>
              <th className="text-right">持股天数</th>
              <th>税档</th>
            </tr>
          </thead>
          <tbody>
            {position.lots.map((lot) => {
              const days = Math.max(
                0,
                Math.floor(
                  (new Date(todayISO()).getTime() - new Date(lot.originalBuyDate).getTime()) / 86400000,
                ),
              );
              const bracket = days <= 30 ? '20%' : days < 365 ? '10%' : '免税';
              return (
                <tr key={lot.id}>
                  <td className="font-mono">{lot.originalBuyDate}</td>
                  <td className="num">{lot.quantity.toFixed(2)}</td>
                  <td className="num">{lot.costPerShare.toFixed(2)}</td>
                  <td className="num">{days}天</td>
                  <td>
                    <span className={bracket === '免税' ? 'text-healthy' : bracket === '10%' ? 'text-warning' : 'text-danger'}>
                      {bracket}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <div className="text-[11px] text-secondary font-medium mb-2">30 日价格走势</div>
        {priceSeries.length > 0 ? (
          <Sparkline data={priceSeries} positive={position.unrealizedPnl >= 0} height={80} />
        ) : (
          <div className="text-[11px] text-disabled">暂无价格数据</div>
        )}
      </div>
    </div>
  );
}

export { HoldingsRowDetail as HoldingsRow };

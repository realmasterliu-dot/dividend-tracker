import React from 'react';
import { TaxLot } from '@/types';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatNumber } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { todayISO } from '@/lib/clock';

/** TaxLot 明细表：各批次买入日 / 数量 / 成本 / 持股期限 / 当前税档（PRD §8.4.4） */
export function TaxLotTable({ lots }: { lots: TaxLot[] }) {
  const { money } = useMoneyFmt();
  const today = todayISO();

  if (lots.length === 0) {
    return (
      <Card title="持仓批次（TaxLot）" bodyClassName="p-4">
        <div className="text-[12px] text-secondary">暂无持仓批次</div>
      </Card>
    );
  }

  return (
    <Card title="持仓批次（TaxLot）" subtitle="FIFO 消耗 · 送转股持股期限从原股买入日起算" bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>买入日</th>
              <th>原始买入日</th>
              <th className="text-right">剩余数量</th>
              <th className="text-right">成本价（本位币）</th>
              <th className="text-right">持股天数</th>
              <th>当前税档</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => {
              const days = Math.max(0, Math.floor((new Date(today).getTime() - new Date(lot.originalBuyDate).getTime()) / 86400000));
              const bracket = days <= 30 ? '20%' : days < 365 ? '10%' : '免税';
              const bracketColor = bracket === '免税' ? 'text-healthy' : bracket === '10%' ? 'text-warning' : 'text-danger';
              return (
                <tr key={lot.id}>
                  <td className="font-mono text-primary">{lot.buyDate}</td>
                  <td className="font-mono text-secondary">
                    {lot.buyDate === lot.originalBuyDate ? '—' : lot.originalBuyDate}
                    {lot.buyDate !== lot.originalBuyDate && (
                      <span className="ml-1 text-[10px] text-disabled">(送转起算)</span>
                    )}
                  </td>
                  <td className="num">{formatNumber(lot.quantity, 2)}</td>
                  <td className="num">{money(lot.costPerShare, 2)}</td>
                  <td className="num">{days}天</td>
                  <td className={bracketColor}>{bracket}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

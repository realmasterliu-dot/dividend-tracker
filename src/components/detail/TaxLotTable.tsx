import React from 'react';
import { TaxLot } from '@/types';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatNumber } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { todayISO } from '@/lib/clock';

export function taxLotPresentation(lot: TaxLot, today: string): {
  days: number;
  bracket: '20%' | '10%' | '免税';
  bracketColor: string;
} {
  const days = Math.max(
    0,
    Math.floor((new Date(today).getTime() - new Date(lot.originalBuyDate).getTime()) / 86400000),
  );
  const bracket = days <= 30 ? '20%' : days < 365 ? '10%' : '免税';
  const bracketColor = bracket === '免税' ? 'text-healthy' : bracket === '10%' ? 'text-warning' : 'text-danger';
  return { days, bracket, bracketColor };
}

/** TaxLot 明细表：各批次买入日 / 数量 / 成本 / 持股期限 / 当前税档（PRD §8.4.4） */
export function TaxLotTable({ lots }: { lots: TaxLot[] }) {
  const { money } = useMoneyFmt();
  const today = todayISO();

  if (lots.length === 0) {
    return (
      <Card title="持仓批次" bodyClassName="p-4">
        <div className="text-[12px] text-secondary">暂无持仓批次</div>
      </Card>
    );
  }

  return (
    <Card title="持仓批次" subtitle="按买入先后扣减 · 送转股沿用原股买入日期" bodyClassName="p-0">
      <div className="divide-y divide-line-soft md:hidden">
        {lots.map((lot) => {
          const { days, bracket, bracketColor } = taxLotPresentation(lot, today);
          return (
            <article key={lot.id} className="space-y-3 px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] text-disabled">买入日期</div>
                  <div className="mt-0.5 font-mono text-[13px] text-primary">{lot.buyDate}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-disabled">剩余数量</div>
                  <div className="num mt-0.5 text-[16px] font-semibold text-primary">{formatNumber(lot.quantity, 2)}</div>
                </div>
              </div>

              <dl className="grid grid-cols-3 gap-2 rounded-lg bg-page/50 px-3 py-2.5">
                <div>
                  <dt className="text-[10px] text-disabled">成本价</dt>
                  <dd className="num mt-0.5 text-left text-[12px] text-primary">{money(lot.costPerShare, 2)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-disabled">已持有</dt>
                  <dd className="num mt-0.5 text-left text-[12px] text-primary">{days} 天</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-disabled">当前税档</dt>
                  <dd className={`mt-0.5 text-[12px] font-medium ${bracketColor}`}>{bracket}</dd>
                </div>
              </dl>

              {lot.buyDate !== lot.originalBuyDate && (
                <p className="text-[11px] text-secondary">
                  原始买入日 <span className="font-mono text-primary">{lot.originalBuyDate}</span>，持有期限从该日计算
                </p>
              )}
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
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
              const { days, bracket, bracketColor } = taxLotPresentation(lot, today);
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

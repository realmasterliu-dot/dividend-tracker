import React, { useMemo, useState } from 'react';
import { useData } from '@/store/DataContext';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatNumber } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

/** 定投执行历史与统计（累计投入/累计份额/平均成本，PRD §5.4.2） */
export function DcaExecutionHistory() {
  const { state, generateDcaTx } = useData();
  const { fmt } = useMoneyFmt();
  const [planFilter, setPlanFilter] = useState<string>('ALL');

  const planById = useMemo(() => new Map(state.plans.map((p) => [p.id, p])), [state.plans]);
  const instrumentById = useMemo(
    () => new Map(state.instruments.map((i) => [i.id, i])),
    [state.instruments],
  );

  const dcaTxs = state.transactions
    .filter((t) => t.meta?.planId)
    .filter((t) => planFilter === 'ALL' || t.meta?.planId === planFilter)
    .sort((a, b) => b.date.localeCompare(a.date));

  // 按计划汇总
  const stats = useMemo(() => {
    const map = new Map<string, { invested: number; quantity: number; count: number }>();
    for (const t of state.transactions) {
      const planId = t.meta?.planId as string | undefined;
      if (!planId) continue;
      const cur = map.get(planId) ?? { invested: 0, quantity: 0, count: 0 };
      cur.invested += t.amount * t.fxRate;
      cur.count += 1;
      if (t.status === 'CONFIRMED') cur.quantity += t.quantity;
      map.set(planId, cur);
    }
    return map;
  }, [state.transactions]);

  return (
    <Card
      title="定投执行历史"
      subtitle="DCA 来源流水（含 PENDING 待确认）"
      bodyClassName="p-3"
      action={
        <div className="flex items-center gap-2">
          <select
            className="rounded-md bg-[#0E1420] border border-line px-2 py-1 text-[12px] text-primary focus:outline-none"
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
          >
            <option value="ALL">全部计划</option>
            {state.plans.map((p) => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const p = state.plans[0];
              if (p) generateDcaTx(p.id, p.nextRunDate ?? '2026-08-10');
            }}
          >
            模拟生成一笔
          </Button>
        </div>
      }
    >
      {dcaTxs.length === 0 ? (
        <div className="text-[12px] text-secondary py-4 text-center">暂无 DCA 流水</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>日期</th>
                <th>计划</th>
                <th>标的</th>
                <th className="text-right">金额</th>
                <th className="text-right">份额</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {dcaTxs.slice(0, 30).map((t) => {
                const plan = planById.get(t.meta?.planId as string);
                const inst = instrumentById.get(t.instrumentId);
                return (
                  <tr key={t.id} className={t.status === 'PENDING' ? 'row-pending' : ''}>
                    <td className="font-mono text-primary">{t.date}</td>
                    <td className="text-secondary">{plan?.id ?? '—'}</td>
                    <td className="text-primary">{inst?.symbol ?? t.instrumentId}</td>
                    <td className="num text-gold">{fmt(t.amount * t.fxRate, 0)}</td>
                    <td className="num">{t.quantity > 0 ? formatNumber(t.quantity, inst?.market === 'CRYPTO' ? 4 : 2) : '待回填'}</td>
                    <td>
                      <Badge variant={t.status === 'CONFIRMED' ? 'green' : t.status === 'PENDING' ? 'orange' : 'gray'}>
                        {t.status}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {stats.size > 0 && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[...stats.entries()].map(([planId, s]) => (
            <div key={planId} className="rounded-md border border-line bg-card/50 px-3 py-2 text-[11px]">
              <div className="text-secondary mb-1">{planId} · {s.count} 期</div>
              <div className="flex justify-between"><span className="text-secondary">累计投入</span><span className="num text-primary">{fmt(s.invested, 0)}</span></div>
              <div className="flex justify-between"><span className="text-secondary">累计确认份额</span><span className="num text-primary">{formatNumber(s.quantity, 2)}</span></div>
              <div className="flex justify-between"><span className="text-secondary">平均成本</span><span className="num text-primary">{s.quantity > 0 ? formatNumber(s.invested / s.quantity, 4) : '—'}</span></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

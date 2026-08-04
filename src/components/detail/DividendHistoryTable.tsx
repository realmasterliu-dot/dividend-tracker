import React, { useState } from 'react';
import { DividendEvent } from '@/types';
import { useData } from '@/store/DataContext';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatMoney, formatPercent, formatPctPlain } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

const statusVariant = {
  PROPOSED: 'prediction',
  APPROVED: 'cyan',
  DECLARED: 'cyan',
  EX_DIVIDEND: 'cyan',
  PAID: 'gold',
  RECONCILED: 'green',
} as const;

/** 分红历史明细：日期/每股/持股数/税前/税率/到手/状态/【回填实际金额】（PRD §8.4.4） */
export function DividendHistoryTable({ dividends }: { dividends: DividendEvent[] }) {
  const { backfillDividend } = useData();
  const { money, fmt } = useMoneyFmt();

  const [backfillFor, setBackfillFor] = useState<string | null>(null);
  const [backfillValue, setBackfillValue] = useState('');

  const sorted = [...dividends].sort((a, b) =>
    (b.payDate ?? b.exDate ?? b.recordDate ?? '').localeCompare(a.payDate ?? a.exDate ?? a.recordDate ?? ''),
  );

  const openBackfill = (d: DividendEvent) => {
    setBackfillFor(d.id);
    setBackfillValue(String(d.actualReceived ?? d.netAmount.toFixed(2)));
  };

  const submitBackfill = () => {
    if (backfillFor) {
      backfillDividend(backfillFor, Number(backfillValue) || 0);
      setBackfillFor(null);
    }
  };

  const active = dividends.find((d) => d.id === backfillFor);

  return (
    <Card title="分红历史明细" subtitle="已宣告实线金柱覆盖预测值 · 回填实际到账做校准闭环" bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>日期</th>
              <th className="text-right">每股</th>
              <th className="text-right">持股数</th>
              <th className="text-right">税前</th>
              <th className="text-right">税率</th>
              <th className="text-right">到手</th>
              <th>状态</th>
              <th>回填</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.id}>
                <td className="font-mono text-primary">{d.payDate ?? d.exDate ?? d.recordDate ?? '待定'}</td>
                <td className="num">{formatMoney(d.perShareAmount, d.currency, 4)}</td>
                <td className="num">{d.quantityAtRecord.toFixed(0)}</td>
                <td className="num text-gold">{money(d.grossAmount, 0)}</td>
                <td className="num">{d.taxRateApplied > 0 ? formatPctPlain(d.taxRateApplied) : '0%'}</td>
                <td className="num text-primary">
                  {d.actualReceived !== undefined
                    ? money(d.actualReceived, 0)
                    : money(d.netAmount, 0)}
                  {d.deviationPct !== undefined && (
                    <span className={`ml-1 text-[10px] ${d.deviationPct >= 0 ? 'text-up' : 'text-down'}`}>
                      ({formatPercent(d.deviationPct)})
                    </span>
                  )}
                </td>
                <td>
                  <Badge variant={statusVariant[d.status]}>{d.status}</Badge>
                  {d.isSpecial && <Badge variant="orange" className="ml-1">特别</Badge>}
                  {d.isEstimate && <Badge variant="prediction" className="ml-1">估算</Badge>}
                </td>
                <td>
                  {(d.status === 'PAID' || d.status === 'RECONCILED') && (
                    <Button size="sm" variant="ghost" onClick={() => openBackfill(d)}>
                      {d.actualReceived !== undefined ? '修改' : '回填'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={backfillFor !== null}
        title={`回填实际到账 · ${active?.instrumentId ?? ''}`}
        onClose={() => setBackfillFor(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBackfillFor(null)}>取消</Button>
            <Button variant="gold" onClick={submitBackfill}>保存并校准</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="实际到账金额（本位币）"
            type="number"
            value={backfillValue}
            onChange={(e) => setBackfillValue(e.target.value)}
            hint="回填后系统计算估算偏差率，显示在「到手」列"
          />
          {active && (
            <div className="text-[11px] text-secondary">
              系统估算 {fmt(active.netAmount)}，回填将把状态置为
              <Badge variant="green" className="ml-1">RECONCILED</Badge>
            </div>
          )}
        </div>
      </Modal>
    </Card>
  );
}

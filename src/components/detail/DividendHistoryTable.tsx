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

const statusLabel: Record<DividendEvent['status'], string> = {
  PROPOSED: '预案',
  APPROVED: '已通过',
  DECLARED: '已宣告',
  EX_DIVIDEND: '已除息',
  PAID: '已到账',
  RECONCILED: '已核对',
};

export function validateBackfillAmount(raw: string): { value?: number; error?: string } {
  if (raw.trim() === '') return { error: '请输入实际到账金额' };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: '请输入有效金额' };
  if (value < 0) return { error: '实际到账金额不能小于 0' };
  return { value };
}

/** 分红历史明细：日期/每股/持股数/税前/税率/到手/状态/【回填实际金额】（PRD §8.4.4） */
export function DividendHistoryTable({ dividends }: { dividends: DividendEvent[] }) {
  const { backfillDividend } = useData();
  const { money, fmt } = useMoneyFmt();

  const [backfillFor, setBackfillFor] = useState<string | null>(null);
  const [backfillValue, setBackfillValue] = useState('');
  const [backfillError, setBackfillError] = useState<string | null>(null);

  const sorted = [...dividends].sort((a, b) =>
    (b.payDate ?? b.exDate ?? b.recordDate ?? '').localeCompare(a.payDate ?? a.exDate ?? a.recordDate ?? ''),
  );

  const openBackfill = (d: DividendEvent) => {
    setBackfillFor(d.id);
    setBackfillValue(String(d.actualReceived ?? d.netAmount.toFixed(2)));
    setBackfillError(null);
  };

  const closeBackfill = () => {
    setBackfillFor(null);
    setBackfillError(null);
  };

  const submitBackfill = () => {
    if (!backfillFor) return;
    const result = validateBackfillAmount(backfillValue);
    if (result.error !== undefined || result.value === undefined) {
      setBackfillError(result.error ?? '请输入有效金额');
      return;
    }
    backfillDividend(backfillFor, result.value);
    closeBackfill();
  };

  const active = dividends.find((d) => d.id === backfillFor);

  return (
    <Card title="分红历史明细" subtitle="已宣告实线金柱覆盖预测值 · 回填实际到账做校准闭环" bodyClassName="p-0">
      {sorted.length === 0 && (
        <div className="px-4 py-8 text-center text-[12px] text-secondary">暂无分红记录</div>
      )}

      <div className="divide-y divide-line-soft md:hidden">
        {sorted.map((d) => (
          <article key={d.id} className="space-y-3 px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[12px] text-secondary">
                  {d.payDate ?? d.exDate ?? d.recordDate ?? '日期待定'}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant={statusVariant[d.status]}>{statusLabel[d.status]}</Badge>
                  {d.isSpecial && <Badge variant="orange">特别股息</Badge>}
                  {d.isEstimate && <Badge variant="prediction">估算</Badge>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] text-disabled">
                  {d.actualReceived !== undefined ? '实际到账' : '预计到手'}
                </div>
                <div className="num mt-0.5 text-[17px] font-semibold text-gold">
                  {money(d.actualReceived ?? d.netAmount, 0)}
                </div>
                {d.deviationPct !== undefined && (
                  <div className={`num text-[10px] ${d.deviationPct >= 0 ? 'text-up' : 'text-down'}`}>
                    偏差 {formatPercent(d.deviationPct)}
                  </div>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-page/50 px-3 py-2.5 text-[12px]">
              <div>
                <dt className="text-[10px] text-disabled">每股分红</dt>
                <dd className="num mt-0.5 text-left text-primary">{formatMoney(d.perShareAmount, d.currency, 4)}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-disabled">登记持股</dt>
                <dd className="num mt-0.5 text-left text-primary">{d.quantityAtRecord.toFixed(0)}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-disabled">税前金额</dt>
                <dd className="num mt-0.5 text-left text-primary">{money(d.grossAmount, 0)}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-disabled">适用税率</dt>
                <dd className="num mt-0.5 text-left text-primary">{d.taxRateApplied > 0 ? formatPctPlain(d.taxRateApplied) : '0%'}</dd>
              </div>
            </dl>

            {(d.status === 'PAID' || d.status === 'RECONCILED') && (
              <Button full size="sm" variant="ghost" className="min-h-11" onClick={() => openBackfill(d)}>
                {d.actualReceived !== undefined ? '修改实际到账' : '填写实际到账'}
              </Button>
            )}
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
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
                  <Badge variant={statusVariant[d.status]}>{statusLabel[d.status]}</Badge>
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
        onClose={closeBackfill}
        footer={
          <>
            <Button variant="ghost" onClick={closeBackfill}>取消</Button>
            <Button variant="gold" onClick={submitBackfill}>保存并校准</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="实际到账金额（本位币）"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={backfillValue}
            aria-invalid={backfillError !== null}
            aria-describedby={backfillError ? 'backfill-amount-error' : undefined}
            onChange={(e) => {
              setBackfillValue(e.target.value);
              setBackfillError(null);
            }}
            hint="回填后系统计算估算偏差率，显示在「到手」列"
          />
          {backfillError && (
            <p id="backfill-amount-error" role="alert" className="text-[12px] text-danger">
              {backfillError}
            </p>
          )}
          {active && (
            <div className="text-[11px] text-secondary">
              系统估算 {fmt(active.netAmount)}，回填将把状态置为
              <Badge variant="green" className="ml-1">已核对</Badge>
            </div>
          )}
        </div>
      </Modal>
    </Card>
  );
}

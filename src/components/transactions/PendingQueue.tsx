import React, { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { Transaction } from '@/types';
import { useData } from '@/store/DataContext';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { pendingTransactions } from '@/store/selectors';

/** 定投草稿必须逐笔填写真实成交份额，永不把 0 份或估算值直接确认进持仓。 */
export function PendingQueue() {
  const { state, confirmPending, voidPending } = useData();
  const { fmt } = useMoneyFmt();
  const pending = pendingTransactions(state);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [actualQty, setActualQty] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (pending.length === 0) return null;

  const instrumentById = new Map(state.instruments.map((instrument) => [instrument.id, instrument]));
  const selected = pending.find((transaction) => transaction.id === confirmFor) ?? null;

  const openConfirm = (transaction: Transaction) => {
    setConfirmFor(transaction.id);
    setActualQty(transaction.quantity > 0 ? String(transaction.quantity) : '');
    setError(null);
  };

  const confirmOne = () => {
    if (!selected) return;
    const quantity = Number(actualQty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('请输入大于 0 的实际成交份额');
      return;
    }
    confirmPending(selected.id, quantity);
    setConfirmFor(null);
    setActualQty('');
    setError(null);
  };

  return (
    <Card
      title="待补全的定投"
      subtitle={`${pending.length} 笔尚未计入持仓，请按成交记录逐笔补全`}
      bodyClassName="p-3 sm:p-4"
    >
      <ul className="space-y-2">
        {pending.map((transaction) => {
          const instrument = instrumentById.get(transaction.instrumentId);
          const amount = transaction.amount * transaction.fxRate;
          return (
            <li
              key={transaction.id}
              className="rounded-xl border border-dashed border-prediction/60 bg-prediction/5 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] font-medium text-primary">
                      {instrument?.symbol ?? transaction.instrumentId}
                    </span>
                    <Badge variant="orange">待补全</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-secondary">{transaction.date} · 计划投入 {fmt(amount, 0)}</p>
                </div>
                <span className="num shrink-0 text-[16px] font-semibold text-gold">{fmt(amount, 0)}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line-soft pt-3 sm:flex sm:justify-end">
                <Button variant="ghost" onClick={() => voidPending([transaction.id])}>
                  <XCircle size={15} /> 作废
                </Button>
                <Button variant="gold" onClick={() => openConfirm(transaction)}>
                  <CheckCircle2 size={15} /> 填写成交
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        open={selected !== null}
        title="填写实际成交份额"
        onClose={() => {
          setConfirmFor(null);
          setError(null);
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmFor(null)}>取消</Button>
            <Button variant="gold" onClick={confirmOne}>确认计入持仓</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl bg-card-hover px-3 py-2.5 text-[12px] text-secondary">
            计划金额 {selected ? fmt(selected.amount * selected.fxRate, 0) : '—'}。成交价格会按“金额 ÷ 实际份额”自动计算。
          </div>
          <Input
            label="实际成交份额"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            autoFocus
            value={actualQty}
            onChange={(event) => {
              setActualQty(event.target.value);
              setError(null);
            }}
            hint="以券商或基金平台的成交结果为准"
          />
          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        </div>
      </Modal>
    </Card>
  );
}

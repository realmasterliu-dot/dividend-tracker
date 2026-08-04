import React, { useState } from 'react';
import { Transaction } from '@/types';
import { useData } from '@/store/DataContext';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { useSettings } from '@/store/SettingsContext';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { pendingTransactions } from '@/store/selectors';

/** 待确认队列：PENDING 半透明行 + 批量确认/作废（PRD §3.2.8） */
export function PendingQueue() {
  const { state, confirmPending, voidPending } = useData();
  const { settings } = useSettings();
  const { fmt } = useMoneyFmt();

  const pending = pendingTransactions(state);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [actualQty, setActualQty] = useState('');

  if (pending.length === 0) return null;

  const instrumentById = new Map(state.instruments.map((i) => [i.id, i]));

  const confirmAll = () => {
    for (const t of pending) confirmPending(t.id);
  };
  const voidAll = () => voidPending(pending.map((t) => t.id));

  const confirmOne = (t: Transaction) => {
    if (confirmFor === t.id) {
      confirmPending(t.id, Number(actualQty) || t.quantity);
      setConfirmFor(null);
    }
  };

  return (
    <Card
      title="待确认队列"
      subtitle={`${pending.length} 笔 PENDING 流水不计入总资产`}
      bodyClassName="p-3"
      action={
        <div className="flex gap-2">
          <Button size="sm" variant="gold" onClick={confirmAll}>一键全部确认</Button>
          <Button size="sm" variant="danger" onClick={voidAll}>全部作废</Button>
        </div>
      }
    >
      <ul className="divide-y divide-line-soft">
        {pending.map((t) => {
          const inst = instrumentById.get(t.instrumentId);
          const confirmAmount = t.amount * t.fxRate;
          return (
            <li key={t.id} className="py-2 opacity-70 border border-dashed border-prediction rounded-md px-2 my-1 bg-prediction/5">
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <Badge variant="orange">PENDING</Badge>
                <span className="font-mono text-primary">{t.date}</span>
                <span className="text-primary">{inst?.symbol ?? t.instrumentId}</span>
                <span className="text-secondary">定投 · 份额待净值回填</span>
                <span className="num text-gold ml-auto">{fmt(confirmAmount, 0)}</span>
                <span className="text-[11px] text-secondary">若确认将增加 {fmt(confirmAmount, 0)}</span>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => { setConfirmFor(t.id); setActualQty(String(t.quantity || '')); }}>
                    确认
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => voidPending([t.id])}>作废</Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        open={confirmFor !== null}
        title="确认定投成交份额"
        onClose={() => setConfirmFor(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmFor(null)}>取消</Button>
            <Button variant="gold" onClick={() => { const t = pending.find((x) => x.id === confirmFor); if (t) confirmOne(t); }}>
              确认并入持仓
            </Button>
          </>
        }
      >
        <Input
          label="实际成交份额"
          type="number"
          value={actualQty}
          onChange={(e) => setActualQty(e.target.value)}
          hint="净值 T+1 公布后回填；与实际不符可逐笔修改"
        />
      </Modal>
    </Card>
  );
}

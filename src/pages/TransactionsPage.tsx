import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { TransactionList } from '@/components/transactions/TransactionList';
import { TransactionForm } from '@/components/transactions/TransactionForm';
import { PendingQueue } from '@/components/transactions/PendingQueue';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/** 流水页：待确认队列 + 流水列表 + 录入表单 */
export function TransactionsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [tab, setTab] = useState<'all' | 'pending' | 'confirmed'>('all');

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-primary">交易流水</h2>
          <p className="text-[12px] text-secondary mt-0.5">
            PENDING 不计入总资产 · 提交后进入等待态（模拟 90 秒重算）
          </p>
        </div>
        <Button variant="gold" onClick={() => setFormOpen(true)}>
          <Plus size={14} /> 录入流水
        </Button>
      </div>

      <PendingQueue />

      <Card
        title="流水列表"
        action={
          <div className="flex rounded border border-line overflow-hidden text-[11px]">
            {([
              { key: 'all', label: '全部' },
              { key: 'pending', label: '待确认' },
              { key: 'confirmed', label: '已确认' },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-2.5 py-1 ${tab === t.key ? 'bg-gold/15 text-gold' : 'text-secondary hover:text-primary'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
        bodyClassName="p-3"
      >
        <TransactionList filter={tab === 'all' ? undefined : tab} />
      </Card>

      <TransactionForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}

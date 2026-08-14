import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Transaction } from '@/types';
import { TransactionList } from '@/components/transactions/TransactionList';
import { TransactionForm } from '@/components/transactions/TransactionForm';
import { PendingQueue } from '@/components/transactions/PendingQueue';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/** 流水页：记录即时落账；待确认只用于定投计划生成的草稿。 */
export function TransactionsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [tab, setTab] = useState<'all' | 'pending' | 'confirmed'>('all');

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (transaction: Transaction) => {
    setEditing(transaction);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4 p-4 sm:p-5 lg:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-primary">交易流水</h1>
          <p className="mt-1 text-[12px] text-secondary">每一次买卖、分红或费用，都在这里清楚留痕。</p>
        </div>
        <Button variant="gold" onClick={openNew}>
          <Plus size={16} /> 记一笔
        </Button>
      </div>

      <PendingQueue />

      <Card
        title="全部记录"
        action={
          <div className="flex min-h-11 overflow-hidden rounded-lg border border-line text-[11px]">
            {([
              { key: 'all', label: '全部' },
              { key: 'pending', label: '待确认' },
              { key: 'confirmed', label: '已确认' },
            ] as const).map((item) => (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`min-w-14 px-2.5 py-2 ${
                  tab === item.key ? 'bg-gold/15 text-gold' : 'text-secondary hover:text-primary'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
        bodyClassName="p-3 sm:p-4"
      >
        <TransactionList
          filter={tab === 'all' ? undefined : tab}
          onEdit={openEdit}
          onRecord={openNew}
        />
      </Card>

      <TransactionForm
        open={formOpen}
        editingTransaction={editing}
        onClose={closeForm}
      />
    </div>
  );
}

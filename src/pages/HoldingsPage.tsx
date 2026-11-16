import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { List, Plus, WalletCards } from 'lucide-react';
import { HoldingsTable } from '@/components/holdings/HoldingsTable';
import { TransactionForm } from '@/components/transactions/TransactionForm';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/** 账本首页：第一笔买入就是新增持仓，不再提供“只建标的不记买入”的错误路径。 */
export function HoldingsPage() {
  const [recordOpen, setRecordOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4 p-4 sm:p-5 lg:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-primary">我的账本</h1>
          <p className="mt-1 text-[12px] text-secondary">持仓由每一笔真实记录自动汇总，无需重复填写。</p>
        </div>
        <Button variant="gold" onClick={() => setRecordOpen(true)}>
          <Plus size={16} /> 记一笔
        </Button>
      </div>

      <div className="flex min-h-11 items-center gap-1 rounded-xl border border-line bg-card p-1 sm:w-fit">
        <span className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-card-hover px-4 text-[12px] font-medium text-primary sm:flex-none">
          <WalletCards size={15} /> 持仓
        </span>
        <Link
          to="/transactions"
          className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-[12px] text-secondary hover:bg-card-hover hover:text-primary sm:flex-none"
        >
          <List size={15} /> 流水
        </Link>
      </div>

      <Card bodyClassName="p-0">
        <HoldingsTable onRecord={() => setRecordOpen(true)} />
      </Card>

      <TransactionForm open={recordOpen} onClose={() => setRecordOpen(false)} />
    </div>
  );
}

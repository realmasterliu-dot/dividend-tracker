import React, { useState } from 'react';
import { DcaPlanList } from '@/components/dca/DcaPlanList';
import { DcaPlanForm } from '@/components/dca/DcaPlanForm';
import { DcaExecutionHistory } from '@/components/dca/DcaExecutionHistory';
import { InvestmentPlan } from '@/types';

/** 定投页（计划 CRUD + 执行历史） */
export function DcaPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvestmentPlan | null>(null);

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-4 px-4 py-5 sm:px-5 lg:px-8 lg:py-8">
      <div>
        <h1 className="text-[20px] font-semibold text-primary">定投计划</h1>
        <p className="mt-1 max-w-2xl text-[12px] leading-5 text-secondary">
          记下投资节奏，到计划日再核对真实成交。计划不会替你下单，也不会在未确认时改变持仓。
        </p>
      </div>

      <DcaPlanList
        onNew={() => { setEditing(null); setFormOpen(true); }}
        onEdit={(plan) => { setEditing(plan); setFormOpen(true); }}
      />
      <DcaExecutionHistory />

      <DcaPlanForm open={formOpen} onClose={() => setFormOpen(false)} editing={editing} />
    </div>
  );
}

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
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-[18px] font-bold text-primary">定投</h2>
        <p className="text-[12px] text-secondary mt-0.5">
          自动排期 → PENDING 流水 → 净值 T+1 回填份额 → 批量确认（默认 auto_confirm=false）
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

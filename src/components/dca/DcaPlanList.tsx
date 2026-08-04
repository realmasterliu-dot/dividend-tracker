import React, { useMemo } from 'react';
import { Pause, Play, Square } from 'lucide-react';
import { InvestmentPlan } from '@/types';
import { useData } from '@/store/DataContext';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { frequencyLabel } from '@/lib/notification';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface DcaPlanListProps {
  onNew: () => void;
  onEdit: (plan: InvestmentPlan) => void;
}

/** 定投计划列表（创建/编辑/暂停/恢复/结束） */
export function DcaPlanList({ onNew, onEdit }: DcaPlanListProps) {
  const { state, pausePlan, resumePlan, endPlan } = useData();
  const { fmt } = useMoneyFmt();
  const instrumentById = useMemo(
    () => new Map(state.instruments.map((i) => [i.id, i])),
    [state.instruments],
  );

  if (state.plans.length === 0) {
    return (
      <Card title="定投计划" bodyClassName="p-4">
        <EmptyState
          title="还没有定投计划"
          description="一键开启：自动排期 → PENDING 流水 → 净值回填 → 批量确认"
          action={<Button variant="gold" onClick={onNew}>创建定投计划</Button>}
        />
      </Card>
    );
  }

  return (
    <Card
      title="定投计划"
      action={<Button variant="gold" size="sm" onClick={onNew}>+ 新建计划</Button>}
      bodyClassName="p-3"
    >
      <div className="space-y-2">
        {state.plans.map((plan) => {
          const inst = instrumentById.get(plan.instrumentId);
          return (
            <div key={plan.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-card/50 px-3 py-2.5">
              <div className="min-w-[160px]">
                <div className="text-[13px] text-primary font-medium">{inst?.name ?? plan.instrumentId}</div>
                <div className="text-[11px] text-secondary font-mono">{inst?.symbol}</div>
              </div>
              <div className="text-[12px]">
                <span className="num text-gold text-[16px]">{fmt(plan.amount, 0)}</span>
                <span className="text-secondary"> / {frequencyLabel(plan.frequency)}</span>
              </div>
              <Badge variant={plan.status === 'ACTIVE' ? 'green' : plan.status === 'PAUSED' ? 'orange' : 'gray'}>
                {plan.status === 'ACTIVE' ? '运行中' : plan.status === 'PAUSED' ? '已暂停' : '已结束'}
              </Badge>
              <span className="text-[11px] text-secondary">
                下次执行 <span className="num text-primary">{plan.nextRunDate ?? '—'}</span>
              </span>
              {plan.autoConfirm && <Badge variant="cyan">自动确认</Badge>}
              {!plan.autoConfirm && <Badge variant="prediction">手动确认</Badge>}
              <div className="ml-auto flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => onEdit(plan)}>编辑</Button>
                {plan.status === 'ACTIVE' ? (
                  <Button size="sm" variant="ghost" onClick={() => pausePlan(plan.id)}>
                    <Pause size={12} /> 暂停
                  </Button>
                ) : plan.status === 'PAUSED' ? (
                  <Button size="sm" variant="ghost" onClick={() => resumePlan(plan.id)}>
                    <Play size={12} /> 恢复
                  </Button>
                ) : null}
                {plan.status !== 'ENDED' && (
                  <Button size="sm" variant="danger" onClick={() => endPlan(plan.id)}>
                    <Square size={12} /> 结束
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-[11px] text-disabled">
        默认 auto_confirm=false（诚实做法）：PENDING 流水需确认后才计入持仓；扣款日遇节假日顺延至下一交易日，月末顺延至最后交易日
      </div>
    </Card>
  );
}

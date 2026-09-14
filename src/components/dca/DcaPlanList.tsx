import React, { useMemo, useState } from 'react';
import { Check, Pause, Play, Square } from 'lucide-react';
import { InvestmentPlan } from '@/types';
import { useData } from '@/store/DataContext';
import { formatMoney } from '@/lib/format';
import { frequencyLabel, nextRunAfter } from '@/lib/notification';
import { todayISO } from '@/lib/clock';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';

interface DcaPlanListProps {
  onNew: () => void;
  onEdit: (plan: InvestmentPlan) => void;
}

const statusLabel: Record<InvestmentPlan['status'], string> = {
  ACTIVE: '进行中',
  PAUSED: '已暂停',
  ENDED: '已结束',
};

/** 定投计划列表（创建/编辑/暂停/恢复/结束） */
export function DcaPlanList({ onNew, onEdit }: DcaPlanListProps) {
  const {
    state,
    pausePlan,
    resumePlan,
    endPlan,
    generateDcaTx,
    upsertPlan,
  } = useData();
  const [ending, setEnding] = useState<InvestmentPlan | null>(null);
  const instrumentById = useMemo(
    () => new Map(state.instruments.map((instrument) => [instrument.id, instrument])),
    [state.instruments],
  );
  const pendingPlanIds = useMemo(
    () => new Set(
      state.transactions
        .filter((transaction) => transaction.status === 'PENDING' && transaction.source === 'DCA')
        .map((transaction) => transaction.meta?.planId as string | undefined)
        .filter((planId): planId is string => Boolean(planId)),
    ),
    [state.transactions],
  );

  const recordThisTime = (plan: InvestmentPlan) => {
    if (plan.status !== 'ACTIVE' || pendingPlanIds.has(plan.id)) return;
    const today = todayISO();
    const scheduledDate = plan.nextRunDate ?? plan.startDate;
    generateDcaTx(plan.id, today);
    upsertPlan({
      ...plan,
      // 按原计划日期推进，避免用户晚几天补记后永久改变原有节奏。
      nextRunDate: nextRunAfter(scheduledDate, plan.frequency, plan.executionDay),
      autoConfirm: false,
    });
  };

  if (state.plans.length === 0) {
    return (
      <Card title="我的计划" bodyClassName="p-4 sm:p-6">
        <EmptyState
          title="还没有定投计划"
          description="设好金额和日期。每次实际成交后，再回来核对数量和价格。"
          action={<Button variant="gold" onClick={onNew}>创建计划</Button>}
        />
      </Card>
    );
  }

  return (
    <>
      <Card
        title="我的计划"
        action={<Button variant="gold" className="min-h-11" onClick={onNew}>+ 新建</Button>}
        bodyClassName="p-3 sm:p-4"
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {state.plans.map((plan) => {
            const instrument = instrumentById.get(plan.instrumentId);
            const hasPending = pendingPlanIds.has(plan.id);
            return (
              <article key={plan.id} className="rounded-xl border border-line bg-card/50 p-3.5 sm:p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-primary">
                      {instrument?.name ?? plan.instrumentId}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-secondary">
                      {instrument?.symbol ?? plan.instrumentId}
                    </div>
                  </div>
                  <Badge variant={plan.status === 'ACTIVE' ? 'green' : plan.status === 'PAUSED' ? 'orange' : 'gray'}>
                    {statusLabel[plan.status]}
                  </Badge>
                </div>

                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[11px] text-secondary">每期金额</div>
                    <div className="num mt-0.5 text-[22px] text-gold">
                      {formatMoney(plan.amount, instrument?.currency ?? 'CNY', 0)}
                    </div>
                  </div>
                  <div className="text-right text-[12px] leading-5 text-secondary">
                    <div>{frequencyLabel(plan.frequency)}</div>
                    <div>计划日期 <span className="num text-primary">{plan.nextRunDate ?? plan.startDate}</span></div>
                  </div>
                </div>

                {plan.autoConfirm && (
                  <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] leading-5 text-warning">
                    此计划来自旧版本。编辑并保存后，将改为逐笔核对成交结果。
                  </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {plan.status === 'ACTIVE' && (
                    <Button
                      variant="gold"
                      className="min-h-11 sm:flex-1"
                      disabled={hasPending}
                      onClick={() => recordThisTime(plan)}
                    >
                      {hasPending ? <><Check size={15} /> 等待核对</> : '记录本次'}
                    </Button>
                  )}
                  <Button className="min-h-11" variant="outline" onClick={() => onEdit(plan)}>编辑</Button>
                  {plan.status === 'ACTIVE' ? (
                    <Button className="min-h-11" variant="ghost" onClick={() => pausePlan(plan.id)}>
                      <Pause size={15} /> 暂停
                    </Button>
                  ) : plan.status === 'PAUSED' ? (
                    <Button className="min-h-11" variant="ghost" onClick={() => resumePlan(plan.id)}>
                      <Play size={15} /> 恢复
                    </Button>
                  ) : null}
                  {plan.status !== 'ENDED' && (
                    <Button className="min-h-11" variant="danger" onClick={() => setEnding(plan)}>
                      <Square size={14} /> 结束
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-disabled">
          「记录本次」只会创建一条待核对记录；填写真实成交数量和价格后，才会计入持仓。
        </p>
      </Card>

      <Modal
        open={ending !== null}
        title="结束这个计划？"
        onClose={() => setEnding(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEnding(null)}>取消</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (ending) endPlan(ending.id);
                setEnding(null);
              }}
            >
              确认结束
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-6 text-secondary">
          结束后不会再显示为进行中，已有的成交记录和持仓不会受到影响。
        </p>
      </Modal>
    </>
  );
}

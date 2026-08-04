import React, { useState } from 'react';
import { InvestmentPlan, PlanFrequency } from '@/types';
import { useData } from '@/store/DataContext';
import { uid, todayISO } from '@/lib/clock';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';

interface DcaPlanFormProps {
  open: boolean;
  onClose: () => void;
  editing?: InvestmentPlan | null;
}

/** 定投计划表单（创建/编辑） */
export function DcaPlanForm({ open, onClose, editing }: DcaPlanFormProps) {
  const { state, upsertPlan } = useData();
  const [instrumentId, setInstrumentId] = useState(editing?.instrumentId ?? state.instruments[0]?.id ?? '');
  const [amount, setAmount] = useState(String(editing?.amount ?? 1000));
  const [frequency, setFrequency] = useState<PlanFrequency>(editing?.frequency ?? 'MONTHLY');
  const [executionDay, setExecutionDay] = useState(String(editing?.executionDay ?? 10));
  const [autoConfirm, setAutoConfirm] = useState(editing?.autoConfirm ?? false);
  const [startDate, setStartDate] = useState(editing?.startDate ?? todayISO());

  const submit = () => {
    const plan: InvestmentPlan = {
      id: editing?.id ?? uid('plan'),
      instrumentId,
      amount: Number(amount) || 0,
      frequency,
      executionDay: Number(executionDay) || 1,
      startDate,
      holidayPolicy: 'NEXT_TRADING_DAY',
      monthEndPolicy: 'LAST_TRADING_DAY',
      autoConfirm,
      status: editing?.status ?? 'ACTIVE',
      nextRunDate: editing?.nextRunDate ?? startDate,
    };
    upsertPlan(plan);
    onClose();
  };

  return (
    <Modal
      open={open}
      title={editing ? '编辑定投计划' : '创建定投计划'}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="gold" onClick={submit}>保存计划</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Select
            label="标的"
            options={state.instruments.map((i) => ({ value: i.id, label: `${i.symbol} · ${i.name}` }))}
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value)}
          />
        </div>
        <Input label="每期金额" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Select
          label="频率"
          options={[
            { value: 'DAILY', label: '每日' },
            { value: 'WEEKLY', label: '每周' },
            { value: 'BIWEEKLY', label: '每两周' },
            { value: 'MONTHLY', label: '每月' },
          ]}
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as PlanFrequency)}
        />
        <Input
          label={frequency === 'MONTHLY' ? '每月几号（1-31）' : '周几（0=周日）'}
          type="number"
          value={executionDay}
          onChange={(e) => setExecutionDay(e.target.value)}
          hint="31 号在小月顺延至月末最后交易日"
        />
        <Input label="开始日期" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 mt-3 text-[12px] text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={autoConfirm}
          onChange={(e) => setAutoConfirm(e.target.checked)}
          className="accent-declared"
        />
        自动确认成交（不进待确认队列）
      </label>
      {autoConfirm && (
        <p className="mt-1 text-[11px] text-warning">
          ⚠ 自动确认在扣款失败/限购时会虚增账目，仅建议用于长期稳定且从不失败的计划
        </p>
      )}
      <p className="mt-2 text-[11px] text-disabled">
        默认 auto_confirm=false：到期生成 PENDING 流水，净值公布后批量确认份额
      </p>
    </Modal>
  );
}

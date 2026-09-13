import React, { useEffect, useMemo, useState } from 'react';
import { InvestmentPlan, PlanFrequency } from '@/types';
import { useData } from '@/store/DataContext';
import { parseISO, uid, todayISO } from '@/lib/clock';
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
  const [instrumentId, setInstrumentId] = useState('');
  const [amount, setAmount] = useState('1000');
  const [frequency, setFrequency] = useState<PlanFrequency>('MONTHLY');
  const [startDate, setStartDate] = useState(todayISO());
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setInstrumentId(editing?.instrumentId ?? state.instruments[0]?.id ?? '');
    setAmount(String(editing?.amount ?? 1000));
    setFrequency(editing?.frequency ?? 'MONTHLY');
    setStartDate(editing?.startDate ?? todayISO());
    setErrors([]);
  }, [editing, open, state.instruments]);

  const selectedInstrument = useMemo(
    () => state.instruments.find((instrument) => instrument.id === instrumentId),
    [instrumentId, state.instruments],
  );

  const changeFrequency = (next: PlanFrequency) => {
    setFrequency(next);
    setErrors([]);
  };

  const executionDay = frequency === 'MONTHLY'
    ? parseISO(startDate).date()
    : frequency === 'DAILY'
      ? 0
      : parseISO(startDate).day();

  const submit = () => {
    const nextErrors: string[] = [];
    const parsedAmount = Number(amount);
    if (!instrumentId || !selectedInstrument) nextErrors.push('请选择要定投的标的');
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) nextErrors.push('每期金额必须大于 0');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !parseISO(startDate).isValid()) nextErrors.push('请选择有效的开始日期');
    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    const plan: InvestmentPlan = {
      id: editing?.id ?? uid('plan'),
      instrumentId,
      amount: parsedAmount,
      frequency,
      executionDay,
      startDate,
      holidayPolicy: 'NEXT_TRADING_DAY',
      monthEndPolicy: 'LAST_TRADING_DAY',
      // 定投计划只负责提醒。真实成交数量和价格必须由用户逐笔核对。
      autoConfirm: false,
      status: editing?.status ?? 'ACTIVE',
      nextRunDate:
        editing &&
        editing.startDate === startDate &&
        editing.frequency === frequency &&
        editing.executionDay === executionDay
          ? editing.nextRunDate ?? startDate
          : startDate,
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
          <Button variant="gold" onClick={submit} disabled={state.instruments.length === 0}>保存计划</Button>
        </>
      }
    >
      {state.instruments.length === 0 ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-[12px] leading-5 text-warning">
          请先添加一个持仓标的，再创建定投计划。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
          <Select
            label="标的"
            options={state.instruments.map((i) => ({ value: i.id, label: `${i.symbol} · ${i.name}` }))}
            value={instrumentId}
            onChange={(e) => { setInstrumentId(e.target.value); setErrors([]); }}
          />
          </div>
          <Input
            label={`每期金额${selectedInstrument ? `（${selectedInstrument.currency}）` : ''}`}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setErrors([]); }}
          />
          <Select
            label="频率"
            options={[
              { value: 'DAILY', label: '每天' },
              { value: 'WEEKLY', label: '每周' },
              { value: 'BIWEEKLY', label: '每两周' },
              { value: 'MONTHLY', label: '每月' },
            ]}
            value={frequency}
            onChange={(e) => changeFrequency(e.target.value as PlanFrequency)}
          />
          <div className="sm:col-span-2">
            <Input
              label="第一次计划日期"
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setErrors([]); }}
              hint={frequency === 'MONTHLY' ? '以后每月按这一天提醒；若当月没有，则按月末提醒' : undefined}
            />
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}
      <p className="mt-4 text-[11px] leading-5 text-disabled">
        到计划日后记录真实成交数量和价格，确认后才会计入持仓。
      </p>
    </Modal>
  );
}

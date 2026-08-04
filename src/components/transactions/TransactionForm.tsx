import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Transaction, TransactionType } from '@/types';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { uid, todayISO } from '@/lib/clock';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: 'BUY', label: '买入 BUY' },
  { value: 'SELL', label: '卖出 SELL' },
  { value: 'DIVIDEND_CASH', label: '现金分红 DIVIDEND_CASH' },
  { value: 'DIVIDEND_REINVEST', label: '红利再投 DIVIDEND_REINVEST' },
  { value: 'SPLIT', label: '拆股 SPLIT' },
  { value: 'BONUS', label: '送股 BONUS' },
  { value: 'TRANSFER', label: '转增 TRANSFER' },
  { value: 'FUND_SPLIT', label: '基金拆分 FUND_SPLIT' },
  { value: 'FEE', label: '费用 FEE' },
  { value: 'INCOME', label: '其他收入 INCOME' },
  { value: 'TAX_WITHHELD', label: '实际扣税 TAX_WITHHELD' },
];

interface TransactionFormProps {
  open: boolean;
  onClose: () => void;
  initialInstrumentId?: string;
}

/** 流水录入表单（12 种类型；提交后进入等待态页模拟 Actions 延迟） */
export function TransactionForm({ open, onClose, initialInstrumentId }: TransactionFormProps) {
  const { state, addTransaction } = useData();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const [type, setType] = useState<TransactionType>('BUY');
  const [instrumentId, setInstrumentId] = useState(initialInstrumentId ?? state.instruments[0]?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [fee, setFee] = useState('');
  const [note, setNote] = useState('');

  const instrument = useMemo(
    () => state.instruments.find((i) => i.id === instrumentId),
    [state.instruments, instrumentId],
  );

  const fxRate = useMemo(() => {
    if (!instrument) return 1;
    if (instrument.currency === settings.baseCurrency) return 1;
    const snap = state.fx[state.fx.length - 1];
    const key = `${instrument.currency}${settings.baseCurrency}`;
    const rate = snap?.rates?.[key];
    return typeof rate === 'number' && rate > 0 ? rate : 1;
  }, [instrument, settings.baseCurrency, state.fx]);

  const qty = Number(quantity) || 0;
  const px = Number(price) || 0;
  const feeVal = Number(fee) || 0;
  const amount = type === 'FEE' || type === 'INCOME' || type === 'TAX_WITHHELD' ? qty * px : Math.abs(qty * px);

  const reset = () => {
    setType('BUY');
    setDate(todayISO());
    setQuantity('');
    setPrice('');
    setFee('');
    setNote('');
  };

  const submit = () => {
    if (!instrument) return;
    const tx: Transaction = {
      id: uid('tx'),
      instrumentId: instrument.id,
      type,
      status: 'CONFIRMED',
      date,
      quantity: type === 'SELL' ? -Math.abs(qty) : qty,
      price: px,
      amount,
      fee: feeVal || undefined,
      currency: instrument.currency,
      fxRate,
      note: note || undefined,
      source: 'MANUAL',
    };
    addTransaction(tx);
    reset();
    onClose();
    // 模拟静态架构延迟：录入后进入等待态（PRD §3.2.11）
    navigate('/submission-status', {
      state: {
        items: [
          { label: '类型', value: TYPE_OPTIONS.find((t) => t.value === type)?.label ?? type },
          { label: '标的', value: instrument.symbol },
          { label: '日期', value: date },
          { label: '数量', value: String(qty) },
          { label: '价格', value: String(px) },
        ],
      },
    });
  };

  const isQuantityType = type === 'BUY' || type === 'SELL' || type === 'DIVIDEND_REINVEST';
  const isAmountType = type === 'FEE' || type === 'INCOME' || type === 'TAX_WITHHELD';

  return (
    <Modal
      open={open}
      title="录入交易流水"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={!instrument}>
            提交（模拟等待 90s）→
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Select
            label="类型"
            options={TYPE_OPTIONS}
            value={type}
            onChange={(e) => setType(e.target.value as TransactionType)}
          />
        </div>
        <div className="col-span-2">
          <Select
            label="标的"
            options={state.instruments.map((i) => ({ value: i.id, label: `${i.symbol} · ${i.name}` }))}
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Input label="日期" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {isQuantityType && (
          <>
            <Input label={type === 'SELL' ? '卖出数量（正数）' : '数量/份额'} type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} hint={instrument?.market === 'CRYPTO' ? '加密 4-8 位小数' : undefined} />
            <Input label="价格（标的币种）" type="number" value={price} onChange={(e) => setPrice(e.target.value)} hint={instrument?.currency ?? ''} />
          </>
        )}
        {isAmountType && (
          <div className="col-span-2">
            <Input label="金额（标的币种）" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} hint="FEE/INCOME/TAX_WITHHELD 使用金额字段" />
          </div>
        )}
        {type === 'SPLIT' || type === 'BONUS' || type === 'TRANSFER' || type === 'FUND_SPLIT' ? (
          <div className="col-span-2">
            <Input label="比例（如 10送2 → 1.2）" type="number" value={price} onChange={(e) => setPrice(e.target.value)} hint="数量按比例调整，成本摊薄，持股期限起算日不变" />
          </div>
        ) : null}
        <Input label="手续费" type="number" value={fee} onChange={(e) => setFee(e.target.value)} />
        <Input label="备注" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="mt-3 text-[11px] text-disabled">
        汇率 {instrument?.currency ?? ''}→{settings.baseCurrency}：<span className="num text-primary">{fxRate.toFixed(4)}</span>
        {type === 'SELL' && <span className="ml-2 text-warning">SELL 按 FIFO 消耗批次，触发 A股或有税负重算</span>}
      </div>
    </Modal>
  );
}

import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Currency, CustodyChannel, Instrument, Market, SecurityType, Transaction } from '@/types';
import { uid } from '@/lib/clock';
import { useData } from '@/store/DataContext';

const MARKETS: Market[] = ['A_SHARE', 'HK', 'US', 'FUND', 'CRYPTO', 'GOLD'];
const CURRENCIES: Currency[] = ['CNY', 'USD', 'HKD'];
const SECURITY_TYPES: SecurityType[] = ['COMMON', 'REIT', 'MLP_PTP', 'ADR', 'ETF', 'FUND', 'CRYPTO', 'GOLD'];
const CUSTODY_CHANNELS: CustodyChannel[] = [
  'CN_BROKER',
  'HK_LOCAL_BROKER',
  'HK_STOCK_CONNECT',
  'US_BROKER',
  'CEX',
  'SGE',
  'PHYSICAL',
];

/** 新增持仓表单（字段以字符串保存，提交时再解析/校验） */
export interface AddHoldingForm {
  /** 代码 / ID / Symbol（归一为 instrument.id 与 symbol） */
  code: string;
  name: string;
  market: Market;
  currency: Currency;
  dividendEligible: boolean;
  securityType: SecurityType;
  custodyChannel: CustodyChannel;
  /** 逗号分隔，可选 */
  tags: string;
  /** 是否同时记录首笔买入 */
  enableFirstBuy: boolean;
  buyDate: string;
  buyQuantity: string;
  buyPrice: string;
  buyCurrency: Currency;
  buyFxRate: string;
  buyNote: string;
}

const EMPTY_FORM: AddHoldingForm = {
  code: '',
  name: '',
  market: 'A_SHARE',
  currency: 'CNY',
  dividendEligible: true,
  securityType: 'COMMON',
  custodyChannel: 'CN_BROKER',
  tags: '',
  enableFirstBuy: false,
  buyDate: '',
  buyQuantity: '',
  buyPrice: '',
  buyCurrency: 'CNY',
  buyFxRate: '1',
  buyNote: '',
};

/** 由表单构造 Instrument（code/id/symbol 归一为同一串） */
export function buildInstrumentFromForm(form: AddHoldingForm): Instrument {
  const id = form.code.trim();
  const tags = form.tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const instrument: Instrument = {
    id,
    symbol: id,
    name: form.name.trim(),
    market: form.market,
    currency: form.currency,
    dividendEligible: form.dividendEligible,
    securityType: form.securityType,
    extraWithholdingRate: 0,
    custodyChannel: form.custodyChannel,
  };
  if (tags.length > 0) instrument.tags = tags;
  return instrument;
}

/** 由表单构造首笔 BUY 流水（仅在 enableFirstBuy 时调用；数量/价格已校验为正） */
export function buildInitialBuy(form: AddHoldingForm, instrumentId: string): Transaction {
  const quantity = Number(form.buyQuantity);
  const price = Number(form.buyPrice);
  const fxRate = form.buyFxRate ? Number(form.buyFxRate) : 1;
  const tx: Transaction = {
    id: uid('tx'),
    instrumentId,
    type: 'BUY',
    status: 'CONFIRMED',
    date: form.buyDate,
    quantity,
    price,
    amount: quantity * price,
    currency: form.buyCurrency,
    fxRate,
    source: 'MANUAL',
  };
  const note = form.buyNote.trim();
  if (note) tx.note = note;
  return tx;
}

/** 解析「正数」：非法/非正 → null（用于首笔买入的数量/价格校验） */
function parsePositiveNumber(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

interface AddHoldingModalProps {
  open: boolean;
  onClose: () => void;
}

const selectClass =
  'w-full rounded-md bg-[#0E1420] border border-line px-2.5 py-1.5 text-[13px] text-primary focus:outline-none focus:border-declared/60 transition-colors';

/** 新增持仓录入入口（模态）：录入标的 + 可选首笔买入 */
export function AddHoldingModal({ open, onClose }: AddHoldingModalProps) {
  const { addInstrument, addTransaction } = useData();
  const [form, setForm] = useState<AddHoldingForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);

  const update = <K extends keyof AddHoldingForm>(key: K, value: AddHoldingForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const reset = () => {
    setForm(EMPTY_FORM);
    setErrors([]);
  };

  const close = () => {
    reset();
    onClose();
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!form.code.trim()) errs.push('代码 / ID / Symbol 必填');
    if (!form.name.trim()) errs.push('名称必填');
    if (!MARKETS.includes(form.market)) errs.push('市场必填');
    if (!CURRENCIES.includes(form.currency)) errs.push('币种必填');
    if (form.enableFirstBuy) {
      if (!form.buyDate) errs.push('首笔买入日期必填');
      if (parsePositiveNumber(form.buyQuantity) === null) errs.push('首笔买入数量必须为正数');
      if (parsePositiveNumber(form.buyPrice) === null) errs.push('首笔买入价格必须为正数');
      if (form.buyFxRate.trim() && parsePositiveNumber(form.buyFxRate) === null) errs.push('汇率必须为正数');
    }
    return errs;
  };

  const handleSubmit = () => {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    const instrument = buildInstrumentFromForm(form);
    addInstrument(instrument); // 同 id 已存在则 reducer 忽略（新增 ≠ 覆盖）
    if (form.enableFirstBuy) {
      addTransaction(buildInitialBuy(form, instrument.id));
    }
    close();
  };

  return (
    <Modal
      open={open}
      title="新增持仓"
      onClose={close}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button variant="primary" onClick={handleSubmit}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="代码 / ID / Symbol"
            value={form.code}
            onChange={(e) => update('code', e.target.value)}
            placeholder="如 600519.SH"
          />
          <Input
            label="名称"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="如 贵州茅台"
          />
          <label className="block">
            <span className="block text-[12px] text-secondary mb-1">市场</span>
            <select
              className={selectClass}
              value={form.market}
              onChange={(e) => update('market', e.target.value as Market)}
            >
              {MARKETS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[12px] text-secondary mb-1">币种</span>
            <select
              className={selectClass}
              value={form.currency}
              onChange={(e) => update('currency', e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[12px] text-secondary mb-1">证券类型</span>
            <select
              className={selectClass}
              value={form.securityType}
              onChange={(e) => update('securityType', e.target.value as SecurityType)}
            >
              {SECURITY_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[12px] text-secondary mb-1">托管渠道</span>
            <select
              className={selectClass}
              value={form.custodyChannel}
              onChange={(e) => update('custodyChannel', e.target.value as CustodyChannel)}
            >
              {CUSTODY_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-[12px] text-secondary">
          <input
            type="checkbox"
            checked={form.dividendEligible}
            onChange={(e) => update('dividendEligible', e.target.checked)}
          />
          可分红（用于股息率 / 税务推导）
        </label>

        <Input
          label="标签（逗号分隔，可选）"
          value={form.tags}
          onChange={(e) => update('tags', e.target.value)}
          placeholder="如 核心持仓,白酒"
        />

        <div className="pt-2 border-t border-line-soft">
          <label className="flex items-center gap-2 text-[12px] text-primary font-medium">
            <input
              type="checkbox"
              checked={form.enableFirstBuy}
              onChange={(e) => {
                const checked = e.target.checked;
                // 勾选时把首笔买入币种默认成标的币种（instrument base）
                update('buyCurrency', checked ? form.currency : form.buyCurrency);
                update('enableFirstBuy', checked);
              }}
            />
            同时记录首笔买入
          </label>
        </div>

        {form.enableFirstBuy && (
          <div className="grid grid-cols-2 gap-3 pl-1">
            <Input
              label="买入日期"
              type="date"
              value={form.buyDate}
              onChange={(e) => update('buyDate', e.target.value)}
            />
            <Input
              label="数量"
              type="number"
              value={form.buyQuantity}
              onChange={(e) => update('buyQuantity', e.target.value)}
              placeholder="如 100"
            />
            <Input
              label="价格"
              type="number"
              value={form.buyPrice}
              onChange={(e) => update('buyPrice', e.target.value)}
              placeholder="如 1700"
            />
            <label className="block">
              <span className="block text-[12px] text-secondary mb-1">买入币种（默认标的币种）</span>
              <select
                className={selectClass}
                value={form.buyCurrency}
                onChange={(e) => update('buyCurrency', e.target.value as Currency)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label="汇率（→本位币，默认 1）"
              type="number"
              min="0"
              value={form.buyFxRate}
              onChange={(e) => update('buyFxRate', e.target.value)}
              placeholder="1"
            />
            <Input
              label="备注（可选）"
              value={form.buyNote}
              onChange={(e) => update('buyNote', e.target.value)}
            />
          </div>
        )}

        {errors.length > 0 && (
          <div className="text-[11px] text-danger space-y-0.5">
            {errors.map((e) => (
              <div key={e}>· {e}</div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

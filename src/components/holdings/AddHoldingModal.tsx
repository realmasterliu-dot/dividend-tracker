import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Currency, CustodyChannel, Instrument, Market, SecurityType, Transaction } from '@/types';
import { uid } from '@/lib/clock';
import { useData } from '@/store/DataContext';
import { searchSymbols, SymbolSuggestion } from '@/data/symbols';

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

/** 下拉关闭延时（ms）：让 onMouseDown 先于 onBlur 生效，避免点击候选项失效 */
const SUGGEST_BLUR_DELAY_MS = 120;

/** 新增持仓录入入口（模态）：录入标的 + 可选首笔买入 */
export function AddHoldingModal({ open, onClose }: AddHoldingModalProps) {
  const { addInstrument, addTransaction } = useData();
  const [form, setForm] = useState<AddHoldingForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  /** onBlur 延时关闭下拉的定时器句柄（卸载时清理，避免内存泄漏） */
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) clearTimeout(blurTimerRef.current);
    };
  }, []);

  const update = <K extends keyof AddHoldingForm>(key: K, value: AddHoldingForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** 关闭候选下拉并清空候选 */
  const closeSuggest = () => {
    setShowSuggest(false);
    setSuggestions([]);
  };

  /**
   * 输入代码 / 名称时刷新候选。
   * 以 code 为主：code 非空时按 code 检索；code 为空则退化为按 name 检索；两者皆空清空候选。
   */
  const refreshSuggestions = (codeValue: string, nameValue: string) => {
    const query = codeValue.trim() ? codeValue : nameValue;
    if (!query.trim()) {
      closeSuggest();
      return;
    }
    setSuggestions(searchSymbols(query));
    setShowSuggest(true);
  };

  /** 点击候选项：一键带出代码/名称/市场/币种/证券类型/托管渠道 */
  const applySuggestion = (s: SymbolSuggestion) => {
    setForm((prev) => ({
      ...prev,
      code: s.code,
      name: s.name,
      market: s.market,
      currency: s.currency,
      securityType: s.securityType,
      custodyChannel: s.custodyChannel,
    }));
    closeSuggest();
  };

  /** 输入框失焦：延时关闭，留出时间让候选项的 onMouseDown 先执行 */
  const handleSuggestBlur = () => {
    if (blurTimerRef.current !== null) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => setShowSuggest(false), SUGGEST_BLUR_DELAY_MS);
  };

  const reset = () => {
    setForm(EMPTY_FORM);
    setErrors([]);
    closeSuggest();
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
          <div className="relative">
            <Input
              label="代码 / ID / Symbol"
              value={form.code}
              autoComplete="off"
              onChange={(e) => {
                const value = e.target.value;
                update('code', value);
                refreshSuggestions(value, form.name);
              }}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggest(true);
              }}
              onBlur={handleSuggestBlur}
              placeholder="如 600519.SH"
            />
            {showSuggest && suggestions.length > 0 && (
              <ul
                className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-line bg-[#0E1420] shadow-lg shadow-black/40"
                role="listbox"
                aria-label="标的候选"
              >
                {suggestions.map((s) => (
                  <li key={s.code} role="option" aria-selected={false}>
                    <button
                      type="button"
                      // 用 onMouseDown 抢在 Input 的 onBlur 之前执行，避免下拉先关导致点击失效
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applySuggestion(s);
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] text-primary hover:bg-white/5 focus:bg-white/5 focus:outline-none transition-colors"
                    >
                      <span className="font-mono tabular-nums text-declared shrink-0">{s.code}</span>
                      <span className="truncate">{s.name}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-disabled">{s.market}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Input
            label="名称"
            value={form.name}
            autoComplete="off"
            onChange={(e) => {
              const value = e.target.value;
              update('name', value);
              refreshSuggestions(form.code, value);
            }}
            onBlur={handleSuggestBlur}
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

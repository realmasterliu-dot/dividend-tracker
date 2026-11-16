import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import type {
  CustodyChannel,
  Currency,
  Instrument,
  Market,
  Transaction,
  TransactionType,
} from '@/types';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { uid, todayISO } from '@/lib/clock';
import { buildTransactionDraft } from '@/lib/transactionDraft';
import { availableQuantityBeforeTransaction } from '@/lib/transactionAvailability';
import { linkCashDividend } from '@/lib/transactionDividend';
import { latestFx } from '@/lib/calc/fx';
import { hasAutomaticMarketData, searchSymbols, type SymbolSuggestion } from '@/data/symbols';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';

const TYPE_OPTIONS: { value: TransactionType; label: string; hint: string }[] = [
  { value: 'BUY', label: '买入', hint: '增加持仓' },
  { value: 'SELL', label: '卖出', hint: '减少持仓' },
  { value: 'DIVIDEND_CASH', label: '收到分红', hint: '记录现金到账' },
  { value: 'DIVIDEND_REINVEST', label: '红利再投', hint: '分红换成份额' },
  { value: 'FEE', label: '费用', hint: '平台费、托管费等' },
  { value: 'INCOME', label: '其他收入', hint: '非分红收入' },
  { value: 'TAX_WITHHELD', label: '实际扣税', hint: '记录已扣税款' },
  { value: 'SPLIT', label: '拆股', hint: '按比例调整份额' },
  { value: 'BONUS', label: '送股', hint: '按比例增加份额' },
  { value: 'TRANSFER', label: '转增', hint: '资本公积转增' },
  { value: 'FUND_SPLIT', label: '基金拆分', hint: '按比例调整份额' },
];

const PRIMARY_TYPES: TransactionType[] = ['BUY', 'SELL', 'DIVIDEND_CASH'];
const QUANTITY_TYPES: TransactionType[] = ['BUY', 'SELL', 'DIVIDEND_REINVEST'];
const AMOUNT_TYPES: TransactionType[] = ['DIVIDEND_CASH', 'FEE', 'INCOME', 'TAX_WITHHELD'];
const RATIO_TYPES: TransactionType[] = ['SPLIT', 'BONUS', 'TRANSFER', 'FUND_SPLIT'];

const MARKET_OPTIONS = [
  { value: 'A_SHARE', label: 'A 股' },
  { value: 'HK', label: '港股' },
  { value: 'US', label: '美股' },
  { value: 'FUND', label: '基金' },
  { value: 'CRYPTO', label: '加密资产' },
  { value: 'GOLD', label: '黄金' },
];

const CURRENCY_OPTIONS = [
  { value: 'CNY', label: '人民币 CNY' },
  { value: 'HKD', label: '港币 HKD' },
  { value: 'USD', label: '美元 USD' },
];

interface TransactionFormProps {
  open: boolean;
  onClose: () => void;
  initialInstrumentId?: string;
  editingTransaction?: Transaction | null;
  onSaved?: (transaction: Transaction) => void;
}

function instrumentFromSuggestion(suggestion: SymbolSuggestion): Instrument {
  return {
    id: suggestion.code,
    symbol: suggestion.code,
    name: suggestion.name,
    market: suggestion.market,
    currency: suggestion.currency,
    dividendEligible: suggestion.securityType !== 'CRYPTO' && suggestion.securityType !== 'GOLD',
    securityType: suggestion.securityType,
    extraWithholdingRate: 0,
    custodyChannel: suggestion.custodyChannel,
  };
}

function manualInstrument(codeValue: string): Instrument {
  const code = codeValue.trim().toUpperCase();
  let market: Market = 'US';
  let currency: Currency = 'USD';

  if (/\.(SH|SZ)$/.test(code)) {
    market = 'A_SHARE';
    currency = 'CNY';
  } else if (/\.HK$/.test(code) || /^\d{5}$/.test(code)) {
    market = 'HK';
    currency = 'HKD';
  } else if (/^\d{6}$/.test(code)) {
    market = 'FUND';
    currency = 'CNY';
  } else if (['BTC', 'ETH', 'SOL', 'USDT'].includes(code)) {
    market = 'CRYPTO';
    currency = 'USD';
  } else if (code.startsWith('AU') || code.startsWith('XAU')) {
    market = 'GOLD';
    currency = 'CNY';
  }

  const isCrypto = market === 'CRYPTO';
  const isGold = market === 'GOLD';
  return {
    id: code,
    symbol: code,
    name: code,
    market,
    currency,
    dividendEligible: !isCrypto && !isGold,
    securityType: isCrypto ? 'CRYPTO' : isGold ? 'GOLD' : market === 'FUND' ? 'FUND' : 'COMMON',
    extraWithholdingRate: 0,
    custodyChannel:
      market === 'A_SHARE' || market === 'FUND'
        ? 'CN_BROKER'
        : market === 'HK'
          ? 'HK_LOCAL_BROKER'
          : market === 'CRYPTO'
            ? 'CEX'
            : market === 'GOLD'
              ? 'SGE'
              : 'US_BROKER',
  };
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function typeLabel(type: TransactionType): string {
  return TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

/** 像记账一样录入一笔；必要的业务校验统一交给 transactionDraft。 */
export function TransactionForm({
  open,
  onClose,
  initialInstrumentId,
  editingTransaction,
  onSaved,
}: TransactionFormProps) {
  const {
    state,
    addInstrument,
    upsertInstrument,
    addTransaction,
    updateTransaction,
    upsertDividend,
  } = useData();
  const { settings } = useSettings();

  const [type, setType] = useState<TransactionType>('BUY');
  const [draftTransactionId, setDraftTransactionId] = useState(() => uid('tx'));
  const [instrumentId, setInstrumentId] = useState('');
  const [draftInstrument, setDraftInstrument] = useState<Instrument | null>(null);
  const [assetQuery, setAssetQuery] = useState('');
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [customInstrument, setCustomInstrument] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [ratio, setRatio] = useState('');
  const [fee, setFee] = useState('');
  const [fxRate, setFxRate] = useState('1');
  const [note, setNote] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreTypesOpen, setMoreTypesOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const findInstrument = (id: string | undefined) =>
    id ? state.instruments.find((item) => item.id === id) ?? null : null;

  const rateFor = (instrument: Instrument | null): number => {
    if (!instrument || instrument.currency === settings.baseCurrency) return 1;
    return latestFx(state.fx, instrument.currency, settings.baseCurrency);
  };

  useEffect(() => {
    if (!open) return;
    const transaction = editingTransaction ?? null;
    setDraftTransactionId(transaction?.id ?? uid('tx'));
    const initial = findInstrument(transaction?.instrumentId ?? initialInstrumentId);
    setType(transaction?.type ?? 'BUY');
    setInstrumentId(initial?.id ?? '');
    setDraftInstrument(null);
    setAssetQuery(initial ? `${initial.symbol} · ${initial.name}` : '');
    setAssetMenuOpen(false);
    setCustomInstrument(false);
    setDate(transaction?.date ?? todayISO());
    setQuantity(
      transaction && QUANTITY_TYPES.includes(transaction.type)
        ? String(Math.abs(transaction.quantity))
        : '',
    );
    setPrice(
      transaction && QUANTITY_TYPES.includes(transaction.type) ? String(transaction.price) : '',
    );
    setAmount(
      transaction && AMOUNT_TYPES.includes(transaction.type) ? String(transaction.amount) : '',
    );
    const transactionRatio = transaction?.meta?.ratio;
    setRatio(typeof transactionRatio === 'number' ? String(transactionRatio) : '');
    setFee(transaction?.fee !== undefined ? String(transaction.fee) : '');
    setFxRate(String(transaction?.fxRate ?? rateFor(initial)));
    setNote(transaction?.note ?? '');
    setDetailsOpen(Boolean(transaction));
    setMoreTypesOpen(Boolean(transaction && !PRIMARY_TYPES.includes(transaction.type)));
    setErrors([]);
    // 表单只在每次打开或切换编辑目标时初始化，行情刷新不应覆盖正在输入的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingTransaction?.id, initialInstrumentId]);

  const selectedInstrument =
    draftInstrument ?? state.instruments.find((item) => item.id === instrumentId) ?? null;

  const existingMatches = useMemo(() => {
    const query = assetQuery.trim().toLowerCase();
    if (!query || selectedInstrument) return [];
    return state.instruments
      .filter((item) =>
        `${item.symbol} ${item.name}`.toLowerCase().includes(query),
      )
      .slice(0, 5);
  }, [assetQuery, selectedInstrument, state.instruments]);

  const symbolMatches = useMemo(() => {
    if (!assetQuery.trim() || selectedInstrument) return [];
    const existingIds = new Set(state.instruments.map((item) => item.id));
    return searchSymbols(assetQuery, 6).filter((item) => !existingIds.has(item.code));
  }, [assetQuery, selectedInstrument, state.instruments]);

  const availableQuantity = useMemo(() => {
    if (!selectedInstrument) return 0;
    return availableQuantityBeforeTransaction({
      transactions: state.transactions,
      instrumentId: selectedInstrument.id,
      date,
      transactionId: draftTransactionId,
    });
  }, [date, draftTransactionId, selectedInstrument, state.transactions]);

  const editingLocked = Boolean(
    editingTransaction &&
      (editingTransaction.status !== 'CONFIRMED' ||
        editingTransaction.source === 'DCA' ||
        typeof editingTransaction.meta?.planId === 'string'),
  );

  const chooseInstrument = (instrument: Instrument, isNew = false) => {
    setInstrumentId(isNew ? '' : instrument.id);
    setDraftInstrument(isNew ? instrument : null);
    setCustomInstrument(false);
    setAssetQuery(`${instrument.symbol} · ${instrument.name}`);
    setAssetMenuOpen(false);
    setFxRate(String(rateFor(instrument)));
    setErrors([]);
  };

  const startCustomInstrument = () => {
    const next = manualInstrument(assetQuery);
    setInstrumentId('');
    setDraftInstrument(next);
    setCustomInstrument(true);
    setAssetQuery(`${next.symbol} · ${next.name}`);
    setAssetMenuOpen(false);
    setFxRate(String(rateFor(next)));
  };

  const updateDraftInstrument = (patch: Partial<Instrument>) => {
    setDraftInstrument((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      if (patch.market) {
        next.securityType = patch.market === 'CRYPTO' ? 'CRYPTO' : patch.market === 'GOLD' ? 'GOLD' : patch.market === 'FUND' ? 'FUND' : 'COMMON';
        next.dividendEligible = patch.market !== 'CRYPTO' && patch.market !== 'GOLD';
        next.custodyChannel =
          patch.market === 'A_SHARE' || patch.market === 'FUND'
            ? 'CN_BROKER'
            : patch.market === 'HK'
              ? 'HK_LOCAL_BROKER'
              : patch.market === 'CRYPTO'
                ? 'CEX'
                : patch.market === 'GOLD'
                  ? 'SGE'
                  : 'US_BROKER';
      }
      return next;
    });
  };

  const resetAsset = (value: string) => {
    setAssetQuery(value);
    setInstrumentId('');
    setDraftInstrument(null);
    setCustomInstrument(false);
    setAssetMenuOpen(true);
    setErrors([]);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (editingLocked) {
      setErrors(['待确认、已作废或定投生成的流水请在对应的待办/定投页面处理']);
      return;
    }
    if (!selectedInstrument) {
      setErrors(['请先选择一个标的']);
      return;
    }

    const result = buildTransactionDraft({
      type,
      instrumentId: selectedInstrument.id,
      date,
      currency: selectedInstrument.currency,
      fxRate: numberOrUndefined(fxRate) ?? 0,
      quantity: numberOrUndefined(quantity),
      price: numberOrUndefined(price),
      amount: numberOrUndefined(amount),
      ratio: numberOrUndefined(ratio),
      fee: numberOrUndefined(fee),
      availableQuantity: type === 'SELL' ? availableQuantity : undefined,
      transactionId: draftTransactionId,
      note,
    });

    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    if (draftInstrument) {
      if (state.instruments.some((item) => item.id === draftInstrument.id)) {
        upsertInstrument(draftInstrument);
      } else {
        addInstrument(draftInstrument);
      }
    }

    const preservedMeta = { ...(editingTransaction?.meta ?? {}) };
    if (!RATIO_TYPES.includes(type)) delete preservedMeta.ratio;
    const mergedMeta = { ...preservedMeta, ...(result.transaction.meta ?? {}) };

    let transaction: Transaction = {
      ...result.transaction,
      status: editingTransaction?.status ?? result.transaction.status,
      source: editingTransaction?.source ?? result.transaction.source,
      meta: Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined,
      fee: result.transaction.fee,
      note: result.transaction.note,
    };

    if (transaction.type === 'DIVIDEND_CASH') {
      const linked = linkCashDividend(transaction, state.dividends, availableQuantity);
      transaction = linked.transaction;
      upsertDividend(linked.event);
    }

    if (editingTransaction) updateTransaction(editingTransaction.id, transaction);
    else addTransaction(transaction);
    onSaved?.(transaction);
    onClose();
  };

  const isQuantityType = QUANTITY_TYPES.includes(type);
  const isAmountType = AMOUNT_TYPES.includes(type);
  const isRatioType = RATIO_TYPES.includes(type);
  const isAdvancedType = !PRIMARY_TYPES.includes(type);
  const numericQuantity = numberOrUndefined(quantity) ?? 0;
  const numericPrice = numberOrUndefined(price) ?? 0;
  const previewAmount = isQuantityType ? numericQuantity * numericPrice : numberOrUndefined(amount) ?? 0;
  const typeDescription = TYPE_OPTIONS.find((item) => item.value === type)?.hint ?? '';

  if (editingLocked) {
    return (
      <Modal
        open={open}
        title="这笔流水需在原入口处理"
        onClose={onClose}
        width="max-w-md"
        footer={<Button type="button" variant="gold" onClick={onClose}>知道了</Button>}
      >
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-4 text-[13px] leading-6 text-secondary">
          待确认、已作废或定投计划生成的流水不能在通用记账表单中修改，避免绕过确认流程或破坏计划关联。请回到待办或定投页面处理。
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={editingTransaction ? '编辑这一笔' : '记一笔'}
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
          <Button type="submit" form="transaction-entry-form" variant="gold">
            <Check size={16} /> {editingTransaction ? '保存修改' : '保存'}
          </Button>
        </>
      }
    >
      <form id="transaction-entry-form" onSubmit={submit} className="space-y-5" noValidate>
        <fieldset>
          <legend className="mb-2 text-[12px] text-secondary">这是一笔</legend>
          <div className="grid grid-cols-4 gap-2">
            {PRIMARY_TYPES.map((item) => {
              const active = type === item;
              return (
                <button
                  key={item}
                  type="button"
                  disabled={Boolean(editingTransaction)}
                  onClick={() => {
                    setType(item);
                    setMoreTypesOpen(false);
                    setErrors([]);
                  }}
                  className={`min-h-12 rounded-xl border px-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    active
                      ? 'border-gold bg-gold/15 text-gold'
                      : 'border-line bg-card text-secondary hover:border-gold/40 hover:text-primary'
                  }`}
                >
                  {typeLabel(item)}
                </button>
              );
            })}
            <button
              type="button"
              disabled={Boolean(editingTransaction)}
              onClick={() => setMoreTypesOpen((value) => !value)}
              className={`flex min-h-12 items-center justify-center gap-1 rounded-xl border px-2 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                isAdvancedType
                  ? 'border-gold bg-gold/15 text-gold'
                  : 'border-line bg-card text-secondary hover:border-gold/40 hover:text-primary'
              }`}
            >
              {isAdvancedType ? typeLabel(type) : '更多'} <ChevronDown size={14} />
            </button>
          </div>
          {(moreTypesOpen || isAdvancedType) && (
            <div className="mt-2">
              <Select
                label="其他类型"
                value={isAdvancedType ? type : ''}
                disabled={Boolean(editingTransaction)}
                onChange={(event) => {
                  const nextType = event.target.value as TransactionType | '';
                  if (!nextType) return;
                  setType(nextType);
                  setErrors([]);
                }}
                options={[
                  { value: '', label: '选择其他类型' },
                  ...TYPE_OPTIONS.filter((item) => !PRIMARY_TYPES.includes(item.value)).map(
                    (item) => ({ value: item.value, label: `${item.label} · ${item.hint}` }),
                  ),
                ]}
              />
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-disabled">{typeDescription}</p>
        </fieldset>

        <div className="relative">
          <label className="block">
            <span className="mb-1 block text-[12px] text-secondary">标的</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-disabled" size={17} />
              <input
                value={assetQuery}
                onChange={(event) => resetAsset(event.target.value)}
                onFocus={() => setAssetMenuOpen(true)}
                placeholder="搜索代码或名称，如 600519、AAPL"
                autoComplete="off"
                className="min-h-12 w-full rounded-xl border border-line bg-[#0E1420] py-2.5 pl-10 pr-3 text-[16px] text-primary placeholder:text-disabled focus:border-gold/60 focus:outline-none sm:text-[13px]"
              />
            </span>
          </label>

          {assetMenuOpen && assetQuery.trim() && !selectedInstrument && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-xl">
              {existingMatches.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseInstrument(item)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 text-left hover:bg-card-hover"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-primary">{item.symbol}</span>
                    <span className="block truncate text-[11px] text-secondary">{item.name}</span>
                  </span>
                  <span className="text-[10px] text-disabled">已有</span>
                </button>
              ))}
              {symbolMatches.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseInstrument(instrumentFromSuggestion(item), true)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 text-left hover:bg-card-hover"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-primary">{item.code}</span>
                    <span className="block truncate text-[11px] text-secondary">{item.name}</span>
                  </span>
                  <span
                    className={`flex shrink-0 items-center gap-1 text-[10px] ${
                      hasAutomaticMarketData(item.code) ? 'text-healthy' : 'text-disabled'
                    }`}
                  >
                    <Plus size={14} />
                    {hasAutomaticMarketData(item.code) ? '自动行情' : '按成本估值'}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={startCustomInstrument}
                className="flex min-h-12 w-full items-center gap-2 rounded-lg px-3 text-left text-[12px] text-secondary hover:bg-card-hover hover:text-primary"
              >
                <Plus size={15} className="text-gold" />
                使用“{assetQuery.trim()}”作为新标的
              </button>
            </div>
          )}

          {selectedInstrument && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-secondary">
              <span className="rounded-full bg-healthy/10 px-2 py-1 text-healthy">已选择</span>
              <span>{selectedInstrument.market} · {selectedInstrument.currency}</span>
              {type === 'SELL' && <span>可卖 {availableQuantity.toLocaleString()}</span>}
            </div>
          )}
        </div>

        {customInstrument && draftInstrument && (
          <div className="rounded-xl border border-line bg-card/60 p-3">
            <p className="mb-3 text-[12px] font-medium text-primary">确认新标的信息</p>
            <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
              <Input
                label="名称"
                value={draftInstrument.name}
                onChange={(event) => {
                  updateDraftInstrument({ name: event.target.value });
                  setAssetQuery(`${draftInstrument.symbol} · ${event.target.value}`);
                }}
              />
              <Select
                label="市场"
                value={draftInstrument.market}
                onChange={(event) => updateDraftInstrument({ market: event.target.value as Market })}
                options={MARKET_OPTIONS}
              />
              <Select
                label="币种"
                value={draftInstrument.currency}
                onChange={(event) => {
                  const currency = event.target.value as Currency;
                  updateDraftInstrument({ currency });
                  setFxRate(String(rateFor({ ...draftInstrument, currency })));
                }}
                options={CURRENCY_OPTIONS}
              />
            </div>
          </div>
        )}

        {selectedInstrument?.market === 'HK' && (
          <Select
            label="港股持有渠道"
            value={selectedInstrument.custodyChannel}
            onChange={(event) => {
              const custodyChannel = event.target.value as CustodyChannel;
              if (draftInstrument) updateDraftInstrument({ custodyChannel });
              else setDraftInstrument({ ...selectedInstrument, custodyChannel });
            }}
            options={[
              { value: 'HK_LOCAL_BROKER', label: '香港券商（通常不预扣股息税）' },
              { value: 'HK_STOCK_CONNECT', label: '港股通（按 20% 估算）' },
            ]}
            hint="只需首次确认，之后会记住；它会影响分红税额估算"
          />
        )}

        {isQuantityType && (
          <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
            <Input
              label={type === 'SELL' ? '卖出数量' : '数量 / 份额'}
              inputMode="decimal"
              type="number"
              min="0"
              step="any"
              placeholder="0"
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
                setErrors([]);
              }}
            />
            <Input
              label={`成交价格${selectedInstrument ? `（${selectedInstrument.currency}）` : ''}`}
              inputMode="decimal"
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={price}
              onChange={(event) => {
                setPrice(event.target.value);
                setErrors([]);
              }}
            />
          </div>
        )}

        {isAmountType && (
          <Input
            label={`${typeLabel(type)}金额${selectedInstrument ? `（${selectedInstrument.currency}）` : ''}`}
            inputMode="decimal"
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setErrors([]);
            }}
          />
        )}

        {isRatioType && (
          <Input
            label="调整比例"
            inputMode="decimal"
            type="number"
            min="0"
            step="any"
            placeholder="例如 10 送 2，填写 1.2"
            value={ratio}
            onChange={(event) => {
              setRatio(event.target.value);
              setErrors([]);
            }}
            hint="填写调整后的份额 ÷ 调整前的份额"
          />
        )}

        {(previewAmount > 0 || (isRatioType && numberOrUndefined(ratio))) && (
          <div className="flex items-center justify-between rounded-xl bg-gold/8 px-4 py-3">
            <span className="text-[12px] text-secondary">
              {isRatioType ? '份额调整为' : type === 'SELL' ? '预计收回' : type === 'BUY' ? '预计支出' : '记录金额'}
            </span>
            <span className="num text-[18px] font-semibold text-gold">
              {isRatioType
                ? `${numberOrUndefined(ratio)?.toLocaleString()} 倍`
                : `${selectedInstrument?.currency ?? ''} ${previewAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            </span>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => setDetailsOpen((value) => !value)}
            className="flex min-h-11 w-full items-center justify-between rounded-lg text-[12px] text-secondary hover:text-primary"
          >
            <span>日期、手续费和备注</span>
            <ChevronDown size={16} className={`transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
          </button>
          {detailsOpen && (
            <div className="space-y-3 rounded-xl border border-line bg-card/40 p-3">
              <Input label="日期" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              {isQuantityType && (
                <Input
                  label={`手续费${selectedInstrument ? `（${selectedInstrument.currency}）` : ''}`}
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="选填"
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                />
              )}
              {selectedInstrument && selectedInstrument.currency !== settings.baseCurrency && (
                <Input
                  label={`汇率（${selectedInstrument.currency} → ${settings.baseCurrency}）`}
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="any"
                  value={fxRate}
                  onChange={(event) => setFxRate(event.target.value)}
                  hint="已自动带出，历史交易可按实际汇率修改"
                />
              )}
              <Input
                label="备注"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="选填，例如券商、账户或用途"
              />
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-[12px] text-danger">
            {errors.map((error) => <div key={error}>• {error}</div>)}
          </div>
        )}
      </form>
    </Modal>
  );
}

import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Transaction } from '@/types';
import { useData } from '@/store/DataContext';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatNumber } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

const typeLabel: Record<Transaction['type'], string> = {
  BUY: '买入',
  SELL: '卖出',
  DIVIDEND_CASH: '现金分红',
  DIVIDEND_REINVEST: '红利再投',
  SPLIT: '拆股',
  BONUS: '送股',
  TRANSFER: '转增',
  FUND_SPLIT: '基金拆分',
  FEE: '费用',
  INCOME: '收入',
  TAX_WITHHELD: '实际扣税',
};

const statusLabel: Record<Transaction['status'], string> = {
  CONFIRMED: '已确认',
  PENDING: '待确认',
  VOIDED: '已作废',
};

interface TransactionListProps {
  filter?: string;
  /** 传入后展示编辑入口；列表本身不猜测编辑方式，更不会把编辑误当成删除。 */
  onEdit?: (transaction: Transaction) => void;
  /** 空状态中的「记一笔」入口。 */
  onRecord?: () => void;
}

function typeBadgeVariant(type: Transaction['type']) {
  if (type === 'DIVIDEND_CASH') return 'gold' as const;
  if (type.startsWith('DIVIDEND')) return 'cyan' as const;
  if (type === 'BUY' || type === 'INCOME') return 'green' as const;
  if (type === 'SELL' || type === 'FEE' || type === 'TAX_WITHHELD') return 'orange' as const;
  return 'gray' as const;
}

function isQuantityType(type: Transaction['type']) {
  return type === 'BUY' || type === 'SELL' || type === 'DIVIDEND_REINVEST';
}

/** 流水列表：桌面表格、手机卡片、真实编辑回调和明确的删除确认。 */
export function TransactionList({ filter, onEdit, onRecord }: TransactionListProps) {
  const { state, deleteTransaction } = useData();
  const { fmt } = useMoneyFmt();
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [instrumentFilter, setInstrumentFilter] = useState<string>('ALL');
  const [deleting, setDeleting] = useState<Transaction | null>(null);

  const instruments = state.instruments;
  const instrumentById = useMemo(
    () => new Map(instruments.map((instrument) => [instrument.id, instrument])),
    [instruments],
  );

  const list = useMemo(() => {
    let next = [...state.transactions].sort((a, b) =>
      b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
    );
    if (typeFilter !== 'ALL') next = next.filter((transaction) => transaction.type === typeFilter);
    if (instrumentFilter !== 'ALL') {
      next = next.filter((transaction) => transaction.instrumentId === instrumentFilter);
    }
    if (filter === 'pending') next = next.filter((transaction) => transaction.status === 'PENDING');
    if (filter === 'confirmed') next = next.filter((transaction) => transaction.status === 'CONFIRMED');
    return next.slice(0, 60);
  }, [filter, instrumentFilter, state.transactions, typeFilter]);

  const confirmDelete = () => {
    if (!deleting) return;
    deleteTransaction(deleting.id);
    setDeleting(null);
  };

  const filters = (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <label className="min-w-0">
        <span className="sr-only">按流水类型筛选</span>
        <select
          className="min-h-11 w-full rounded-lg border border-line bg-[#0E1420] px-3 text-[13px] text-primary focus:outline-none focus:ring-2 focus:ring-declared/30 sm:min-w-[132px]"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="ALL">全部类型</option>
          {Object.entries(typeLabel).map(([key, value]) => (
            <option key={key} value={key}>{value}</option>
          ))}
        </select>
      </label>
      <label className="min-w-0">
        <span className="sr-only">按标的筛选</span>
        <select
          className="min-h-11 w-full rounded-lg border border-line bg-[#0E1420] px-3 text-[13px] text-primary focus:outline-none focus:ring-2 focus:ring-declared/30 sm:min-w-[132px]"
          value={instrumentFilter}
          onChange={(event) => setInstrumentFilter(event.target.value)}
        >
          <option value="ALL">全部标的</option>
          {instruments.map((instrument) => (
            <option key={instrument.id} value={instrument.id}>
              {instrument.symbol} · {instrument.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <div>
      {filters}

      {list.length === 0 ? (
        <EmptyState
          title={state.transactions.length === 0 ? '还没有流水' : '没有符合筛选条件的流水'}
          description={
            state.transactions.length === 0
              ? '买入、卖出或收到分红时，像记账一样记下一笔即可。'
              : '可以换个筛选条件，或直接记一笔新流水。'
          }
          action={
            onRecord ? (
              <Button variant="gold" className="min-h-11 px-4" onClick={onRecord}>
                <Plus size={16} /> 记一笔
              </Button>
            ) : (
              <span className="text-[12px] text-secondary">点击页面下方的「记一笔」开始记录</span>
            )
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="tbl">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>类型</th>
                  <th>标的</th>
                  <th className="text-right">数量</th>
                  <th className="text-right">价格</th>
                  <th className="text-right">金额</th>
                  <th>状态</th>
                  <th>备注</th>
                  <th className="w-28 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((transaction) => {
                  const instrument = instrumentById.get(transaction.instrumentId);
                  return (
                    <tr key={transaction.id} className={transaction.status === 'PENDING' ? 'row-pending' : ''}>
                      <td className="font-mono text-primary">{transaction.date}</td>
                      <td>
                        <Badge variant={typeBadgeVariant(transaction.type)}>{typeLabel[transaction.type]}</Badge>
                      </td>
                      <td className="text-primary">{instrument?.symbol ?? transaction.instrumentId}</td>
                      <td className="num">
                        {isQuantityType(transaction.type)
                          ? formatNumber(transaction.quantity, instrument?.market === 'CRYPTO' ? 4 : 2)
                          : '—'}
                      </td>
                      <td className="num">{transaction.price > 0 ? formatNumber(transaction.price, 2) : '—'}</td>
                      <td className={`num ${transaction.type === 'DIVIDEND_CASH' ? 'text-gold' : 'text-primary'}`}>
                        {fmt(transaction.amount * transaction.fxRate, 0)}
                      </td>
                      <td>
                        <Badge variant={transaction.status === 'CONFIRMED' ? 'green' : transaction.status === 'PENDING' ? 'orange' : 'gray'}>
                          {statusLabel[transaction.status]}
                        </Badge>
                      </td>
                      <td className="max-w-[160px] truncate text-secondary" title={transaction.note}>
                        {transaction.note ?? ''}
                      </td>
                      <td>
                        <div className="flex min-w-[92px] justify-end gap-1">
                          {onEdit && (
                            <button
                              type="button"
                              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-secondary hover:bg-card-hover hover:text-primary"
                              aria-label={`编辑 ${transaction.date} 的${typeLabel[transaction.type]}流水`}
                              title="编辑"
                              onClick={() => onEdit(transaction)}
                            >
                              <Pencil size={16} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-secondary hover:bg-danger/10 hover:text-danger"
                            aria-label={`删除 ${transaction.date} 的${typeLabel[transaction.type]}流水`}
                            title="删除"
                            onClick={() => setDeleting(transaction)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {list.map((transaction) => {
              const instrument = instrumentById.get(transaction.instrumentId);
              return (
                <article
                  key={transaction.id}
                  className="rounded-xl border border-line bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[15px] font-semibold text-primary">
                          {instrument?.symbol ?? transaction.instrumentId}
                        </span>
                        <Badge variant={typeBadgeVariant(transaction.type)}>{typeLabel[transaction.type]}</Badge>
                      </div>
                      <div className="mt-1 truncate text-[12px] text-secondary">
                        {instrument?.name ?? '未找到标的信息'} · {transaction.date}
                      </div>
                    </div>
                    <Badge variant={transaction.status === 'CONFIRMED' ? 'green' : transaction.status === 'PENDING' ? 'orange' : 'gray'}>
                      {statusLabel[transaction.status]}
                    </Badge>
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <span className="block text-[10px] text-disabled">金额</span>
                      <span className={`num mt-0.5 block text-[19px] font-semibold ${transaction.type === 'DIVIDEND_CASH' ? 'text-gold' : 'text-primary'}`}>
                        {fmt(transaction.amount * transaction.fxRate, 0)}
                      </span>
                    </div>
                    {isQuantityType(transaction.type) && (
                      <div className="text-right">
                        <span className="block text-[10px] text-disabled">数量 × 价格</span>
                        <span className="num mt-0.5 block text-[13px] text-primary">
                          {formatNumber(transaction.quantity, instrument?.market === 'CRYPTO' ? 4 : 2)} × {formatNumber(transaction.price, 2)}
                        </span>
                      </div>
                    )}
                  </div>

                  {transaction.note && (
                    <p className="mt-3 border-t border-line/70 pt-3 text-[12px] leading-5 text-secondary">
                      {transaction.note}
                    </p>
                  )}

                  <div className="mt-3 flex justify-end gap-2 border-t border-line/70 pt-2">
                    {onEdit && (
                      <button
                        type="button"
                        className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] text-secondary active:bg-card-hover active:text-primary"
                        onClick={() => onEdit(transaction)}
                      >
                        <Pencil size={16} /> 编辑
                      </button>
                    )}
                    <button
                      type="button"
                      className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] text-secondary active:bg-danger/10 active:text-danger"
                      onClick={() => setDeleting(transaction)}
                    >
                      <Trash2 size={16} /> 删除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {deleting && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDeleting(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-transaction-title"
            aria-describedby="delete-transaction-description"
            className="w-full rounded-t-2xl border border-line bg-[#101722] p-5 shadow-2xl sm:max-w-sm sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="delete-transaction-title" className="text-[16px] font-semibold text-primary">
                  确定删除这笔流水？
                </h3>
                <p id="delete-transaction-description" className="mt-2 text-[13px] leading-5 text-secondary">
                  将删除 {deleting.date} 的「{typeLabel[deleting.type]}」记录。持仓、盈亏和分红统计会随之重新计算，此操作不能撤销。
                </p>
              </div>
              <button
                type="button"
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-card-hover hover:text-primary"
                onClick={() => setDeleting(null)}
                aria-label="关闭删除确认"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button className="min-h-11" onClick={() => setDeleting(null)}>
                保留
              </Button>
              <Button variant="danger" className="min-h-11" onClick={confirmDelete}>
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

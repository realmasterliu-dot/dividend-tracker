import React, { useMemo, useState } from 'react';
import type { Transaction } from '@/types';
import { useData } from '@/store/DataContext';
import { formatMoney, formatNumber } from '@/lib/format';
import { frequencyLabel } from '@/lib/notification';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

const statusLabel: Record<Transaction['status'], string> = {
  CONFIRMED: '已计入',
  PENDING: '待核对',
  VOIDED: '未成交',
};

/** 定投执行历史：待核对记录必须逐笔填写真实数量和价格后才能计入持仓。 */
export function DcaExecutionHistory() {
  const { state, confirmPending, updateTransaction, voidPending } = useData();
  const [planFilter, setPlanFilter] = useState<string>('ALL');
  const [confirming, setConfirming] = useState<Transaction | null>(null);
  const [actualQuantity, setActualQuantity] = useState('');
  const [actualPrice, setActualPrice] = useState('');
  const [confirmError, setConfirmError] = useState('');

  const planById = useMemo(() => new Map(state.plans.map((plan) => [plan.id, plan])), [state.plans]);
  const instrumentById = useMemo(
    () => new Map(state.instruments.map((instrument) => [instrument.id, instrument])),
    [state.instruments],
  );

  const dcaTransactions = useMemo(
    () => state.transactions
      .filter((transaction) => transaction.source === 'DCA' || transaction.meta?.planId)
      .filter((transaction) => planFilter === 'ALL' || transaction.meta?.planId === planFilter)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [planFilter, state.transactions],
  );

  const stats = useMemo(() => {
    const result = new Map<string, {
      invested: number;
      quantity: number;
      confirmedCount: number;
      pendingCount: number;
    }>();
    for (const transaction of state.transactions) {
      const planId = transaction.meta?.planId as string | undefined;
      if (!planId) continue;
      const current = result.get(planId) ?? {
        invested: 0,
        quantity: 0,
        confirmedCount: 0,
        pendingCount: 0,
      };
      if (transaction.status === 'CONFIRMED') {
        current.invested += transaction.amount;
        current.quantity += transaction.quantity;
        current.confirmedCount += 1;
      } else if (transaction.status === 'PENDING') {
        current.pendingCount += 1;
      }
      result.set(planId, current);
    }
    return result;
  }, [state.transactions]);

  const openConfirmation = (transaction: Transaction) => {
    setConfirming(transaction);
    setActualQuantity(transaction.quantity > 0 ? String(transaction.quantity) : '');
    setActualPrice(transaction.price > 0 ? String(transaction.price) : '');
    setConfirmError('');
  };

  const closeConfirmation = () => {
    setConfirming(null);
    setActualQuantity('');
    setActualPrice('');
    setConfirmError('');
  };

  const confirmTrade = () => {
    if (!confirming) return;
    const quantity = Number(actualQuantity);
    const price = Number(actualPrice);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setConfirmError('实际成交数量必须大于 0');
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setConfirmError('实际成交价格必须大于 0');
      return;
    }

    const amount = quantity * price;
    updateTransaction(confirming.id, { quantity, price, amount });
    confirmPending(confirming.id, quantity);
    closeConfirmation();
  };

  const renderAction = (transaction: Transaction) => {
    if (transaction.status !== 'PENDING') return null;
    return (
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button className="min-h-11" variant="gold" onClick={() => openConfirmation(transaction)}>
          填写成交结果
        </Button>
        <Button className="min-h-11" variant="ghost" onClick={() => voidPending([transaction.id])}>
          未成交
        </Button>
      </div>
    );
  };

  return (
    <>
      <Card
        title="执行记录"
        subtitle="只有核对过的真实成交才会计入持仓"
        bodyClassName="p-3 sm:p-4"
      >
        {state.plans.length > 1 && (
          <label className="mb-3 block sm:max-w-[280px]">
            <span className="sr-only">按计划筛选</span>
            <select
              className="min-h-11 w-full rounded-lg border border-line bg-[#0E1420] px-3 text-[13px] text-primary focus:outline-none focus:ring-2 focus:ring-declared/30"
              value={planFilter}
              onChange={(event) => setPlanFilter(event.target.value)}
            >
              <option value="ALL">全部计划</option>
              {state.plans.map((plan) => {
                const instrument = instrumentById.get(plan.instrumentId);
                return (
                  <option key={plan.id} value={plan.id}>
                    {instrument?.symbol ?? plan.instrumentId} · {frequencyLabel(plan.frequency)}
                  </option>
                );
              })}
            </select>
          </label>
        )}

        {dcaTransactions.length === 0 ? (
          <div className="py-7 text-center">
            <div className="text-[13px] text-primary">还没有执行记录</div>
            <p className="mt-1 text-[12px] leading-5 text-secondary">实际扣款或买入后，在上方计划中点「记录本次」。</p>
          </div>
        ) : (
          <>
            <div className="space-y-2 md:hidden">
              {dcaTransactions.slice(0, 30).map((transaction) => {
                const instrument = instrumentById.get(transaction.instrumentId);
                const plan = planById.get(transaction.meta?.planId as string);
                return (
                  <article key={transaction.id} className="rounded-xl border border-line bg-card/50 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-medium text-primary">
                          {instrument?.symbol ?? transaction.instrumentId}
                        </div>
                        <div className="mt-0.5 text-[11px] text-secondary">
                          {transaction.date} · {plan ? frequencyLabel(plan.frequency) : '定投'}
                        </div>
                      </div>
                      <Badge variant={transaction.status === 'CONFIRMED' ? 'green' : transaction.status === 'PENDING' ? 'orange' : 'gray'}>
                        {statusLabel[transaction.status]}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-[#0E1420]/70 p-3">
                      <div>
                        <div className="text-[10px] text-secondary">成交金额</div>
                        <div className="num mt-1 text-[14px] text-gold">
                          {formatMoney(transaction.amount, transaction.currency, 2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-secondary">成交数量</div>
                        <div className="num mt-1 text-[14px] text-primary">
                          {transaction.quantity > 0 ? formatNumber(transaction.quantity, instrument?.market === 'CRYPTO' ? 6 : 4) : '尚未填写'}
                        </div>
                      </div>
                    </div>
                    {transaction.status === 'PENDING' && <div className="mt-3">{renderAction(transaction)}</div>}
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>标的</th>
                    <th className="text-right">成交金额</th>
                    <th className="text-right">成交数量</th>
                    <th className="text-right">成交价格</th>
                    <th>状态</th>
                    <th className="text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {dcaTransactions.slice(0, 30).map((transaction) => {
                    const instrument = instrumentById.get(transaction.instrumentId);
                    return (
                      <tr key={transaction.id} className={transaction.status === 'PENDING' ? 'row-pending' : ''}>
                        <td className="font-mono text-primary">{transaction.date}</td>
                        <td className="text-primary">{instrument?.symbol ?? transaction.instrumentId}</td>
                        <td className="num text-right text-gold">{formatMoney(transaction.amount, transaction.currency, 2)}</td>
                        <td className="num text-right">
                          {transaction.quantity > 0 ? formatNumber(transaction.quantity, instrument?.market === 'CRYPTO' ? 6 : 4) : '—'}
                        </td>
                        <td className="num text-right">
                          {transaction.price > 0 ? formatMoney(transaction.price, transaction.currency, 4) : '—'}
                        </td>
                        <td>
                          <Badge variant={transaction.status === 'CONFIRMED' ? 'green' : transaction.status === 'PENDING' ? 'orange' : 'gray'}>
                            {statusLabel[transaction.status]}
                          </Badge>
                        </td>
                        <td><div className="flex justify-end">{renderAction(transaction)}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {stats.size > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...stats.entries()].map(([planId, summary]) => {
              const plan = planById.get(planId);
              const instrument = plan ? instrumentById.get(plan.instrumentId) : undefined;
              const currency = instrument?.currency ?? 'CNY';
              return (
                <div key={planId} className="rounded-xl border border-line bg-card/50 px-3 py-3 text-[11px]">
                  <div className="mb-2 flex items-center justify-between gap-2 text-secondary">
                    <span className="truncate">{instrument?.symbol ?? '定投计划'}</span>
                    {summary.pendingCount > 0 && <span className="shrink-0 text-warning">{summary.pendingCount} 笔待核对</span>}
                  </div>
                  <div className="flex justify-between gap-3"><span className="text-secondary">累计成交</span><span className="num text-primary">{formatMoney(summary.invested, currency, 2)}</span></div>
                  <div className="mt-1 flex justify-between gap-3"><span className="text-secondary">累计数量</span><span className="num text-primary">{formatNumber(summary.quantity, instrument?.market === 'CRYPTO' ? 6 : 4)}</span></div>
                  <div className="mt-1 flex justify-between gap-3"><span className="text-secondary">平均成本</span><span className="num text-primary">{summary.quantity > 0 ? formatMoney(summary.invested / summary.quantity, currency, 4) : '—'}</span></div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={confirming !== null}
        title="核对真实成交"
        onClose={closeConfirmation}
        footer={
          <>
            <Button variant="ghost" onClick={closeConfirmation}>取消</Button>
            <Button variant="gold" onClick={confirmTrade}>确认并计入持仓</Button>
          </>
        }
      >
        {confirming && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-card/50 p-3 text-[12px]">
              <div className="flex justify-between gap-3 text-secondary">
                <span>计划金额</span>
                <span className="num text-primary">{formatMoney(confirming.amount, confirming.currency, 2)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3 text-secondary">
                <span>成交日期</span>
                <span className="num text-primary">{confirming.date}</span>
              </div>
            </div>
            <Input
              label="实际成交数量"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              autoFocus
              value={actualQuantity}
              onChange={(event) => { setActualQuantity(event.target.value); setConfirmError(''); }}
              hint="请以券商或基金平台的成交记录为准"
            />
            <Input
              label={`实际成交价格（${confirming.currency}）`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={actualPrice}
              onChange={(event) => { setActualPrice(event.target.value); setConfirmError(''); }}
            />
            {Number(actualQuantity) > 0 && Number(actualPrice) > 0 && (
              <div className="flex justify-between rounded-lg bg-gold/10 px-3 py-2 text-[12px]">
                <span className="text-secondary">实际成交金额</span>
                <span className="num text-gold">
                  {formatMoney(Number(actualQuantity) * Number(actualPrice), confirming.currency, 2)}
                </span>
              </div>
            )}
            {confirmError && (
              <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                {confirmError}
              </p>
            )}
            <p className="text-[11px] leading-5 text-disabled">
              未填写或填写为 0 时无法确认，避免把空记录误计入持仓。
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}

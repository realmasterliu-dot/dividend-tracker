import React, { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Transaction } from '@/types';
import { useData } from '@/store/DataContext';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatNumber } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

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

interface TransactionListProps {
  filter?: string;
}

/** 流水列表（筛选/编辑/删除） */
export function TransactionList({ filter }: TransactionListProps) {
  const { state, deleteTransaction } = useData();
  const { fmt } = useMoneyFmt();
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [instrumentFilter, setInstrumentFilter] = useState<string>('ALL');

  const instruments = state.instruments;
  const instrumentById = new Map(instruments.map((i) => [i.id, i]));

  let list = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date));
  if (typeFilter !== 'ALL') list = list.filter((t) => t.type === typeFilter);
  if (instrumentFilter !== 'ALL') list = list.filter((t) => t.instrumentId === instrumentFilter);
  if (filter === 'pending') list = list.filter((t) => t.status === 'PENDING');
  if (filter === 'confirmed') list = list.filter((t) => t.status === 'CONFIRMED');

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          className="rounded-md bg-[#0E1420] border border-line px-2 py-1 text-[12px] text-primary focus:outline-none"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="ALL">全部类型</option>
          {Object.entries(typeLabel).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          className="rounded-md bg-[#0E1420] border border-line px-2 py-1 text-[12px] text-primary focus:outline-none"
          value={instrumentFilter}
          onChange={(e) => setInstrumentFilter(e.target.value)}
        >
          <option value="ALL">全部标的</option>
          {instruments.map((i) => (
            <option key={i.id} value={i.id}>{i.symbol}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
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
              <th className="w-16">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 60).map((t) => {
              const inst = instrumentById.get(t.instrumentId);
              return (
                <tr key={t.id} className={t.status === 'PENDING' ? 'row-pending' : ''}>
                  <td className="font-mono text-primary">{t.date}</td>
                  <td>
                    <Badge variant={t.type === 'DIVIDEND_CASH' ? 'gold' : t.type.startsWith('DIVIDEND') ? 'cyan' : 'gray'}>
                      {typeLabel[t.type]}
                    </Badge>
                  </td>
                  <td className="text-primary">{inst?.symbol ?? t.instrumentId}</td>
                  <td className="num">{t.type === 'BUY' || t.type === 'SELL' || t.type === 'DIVIDEND_REINVEST' ? formatNumber(t.quantity, inst?.market === 'CRYPTO' ? 4 : 2) : '—'}</td>
                  <td className="num">{t.price > 0 ? formatNumber(t.price, 2) : '—'}</td>
                  <td className={`num ${t.type === 'DIVIDEND_CASH' ? 'text-gold' : 'text-primary'}`}>
                    {fmt(t.amount * t.fxRate, 0)}
                  </td>
                  <td>
                    <Badge variant={t.status === 'CONFIRMED' ? 'green' : t.status === 'PENDING' ? 'orange' : 'gray'}>
                      {t.status}
                    </Badge>
                  </td>
                  <td className="text-secondary max-w-[160px] truncate" title={t.note}>{t.note ?? ''}</td>
                  <td>
                    <div className="flex gap-1">
                      <button className="text-secondary hover:text-primary p-0.5" title="编辑（暂为删除演示）" onClick={() => deleteTransaction(t.id)}>
                        <Pencil size={12} />
                      </button>
                      <button className="text-secondary hover:text-danger p-0.5" title="删除" onClick={() => deleteTransaction(t.id)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

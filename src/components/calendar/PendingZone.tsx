import React, { useState } from 'react';
import { PendingItem } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { useData } from '@/store/DataContext';

/** ★ 日期待定区：董事会预案（灰虚线）/ 股东大会通过（青）PRD §3.2.1 */
export function PendingZone({ items }: { items: PendingItem[] }) {
  const { fmt } = useMoneyFmt();
  const { state } = useData();
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, 4);
  const instruments = new Map(state.instruments.map((instrument) => [instrument.id, instrument]));

  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border border-dashed border-prediction bg-prediction/5 p-3 sm:p-4" aria-labelledby="pending-dividend-title">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 id="pending-dividend-title" className="text-[14px] font-semibold text-primary">日期待定</h2>
          <p className="mt-0.5 text-[11px] text-secondary">已有分红消息，实施日期尚未公告</p>
        </div>
        <span className="num rounded-full border border-line bg-card px-2 py-1 text-[11px] text-secondary">{items.length} 项</span>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {visibleItems.map((item) => {
          const instrument = instruments.get(item.dividend.instrumentId);
          return (
          <article
            key={item.dividend.id}
            className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13px] font-medium text-primary">
                  {instrument?.name ?? item.dividend.instrumentId}
                </span>
                {instrument && <span className="shrink-0 font-mono text-[10px] text-secondary">{instrument.symbol}</span>}
              </div>
              <div className="mt-1">
                <Badge variant={item.stage === 'PROPOSED' ? 'prediction' : 'cyan'}>
                  {item.stage === 'PROPOSED' ? '董事会预案' : '股东大会通过'}
                </Badge>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="num text-[14px] font-semibold text-gold">
                {fmt(item.dividend.grossAmount || item.dividend.perShareAmount * item.dividend.quantityAtRecord, 0)}
              </div>
              <div className="mt-0.5 text-[10px] text-disabled">预计分红</div>
            </div>
          </article>
        );})}
      </div>

      {items.length > 4 && (
        <button
          type="button"
          className="mt-2 min-h-11 w-full rounded-md text-[12px] font-medium text-secondary transition-colors hover:bg-card-hover hover:text-primary"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : `查看其余 ${items.length - 4} 项`}
        </button>
      )}
    </section>
  );
}

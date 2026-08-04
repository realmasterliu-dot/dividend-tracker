import React from 'react';
import { PendingItem } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';

/** ★ 日期待定区：董事会预案（灰虚线）/ 股东大会通过（青）PRD §3.2.1 */
export function PendingZone({ items }: { items: PendingItem[] }) {
  const { fmt } = useMoneyFmt();

  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-dashed border-prediction bg-prediction/5 p-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-medium text-secondary">日期待定区</span>
        <span className="text-[10px] text-disabled">日期未公告，不落入具体日历格</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <div
            key={item.dividend.id}
            className="flex items-center gap-2 rounded-md border border-line bg-card px-2.5 py-1.5"
          >
            <span className="text-[12px] text-primary font-medium">{item.dividend.instrumentId}</span>
            <Badge variant={item.stage === 'PROPOSED' ? 'prediction' : 'cyan'}>
              {item.stage === 'PROPOSED' ? '董事会预案' : '股东大会通过'}
            </Badge>
            <span className="text-[11px] text-secondary">约</span>
            <span className="num text-[12px] text-gold">
              {fmt(item.dividend.grossAmount || item.dividend.perShareAmount * item.dividend.quantityAtRecord, 0)}
            </span>
            <span className="text-[10px] text-disabled">登记日待公告</span>
          </div>
        ))}
      </div>
    </div>
  );
}

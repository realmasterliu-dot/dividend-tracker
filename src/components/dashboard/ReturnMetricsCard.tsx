import React from 'react';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { formatPctPlain } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Tooltip } from '@/components/ui/Tooltip';

/** 收益率指标卡：XIRR / TWR / YOC */
export function ReturnMetricsCard() {
  const { metrics } = usePortfolio();

  const items = [
    {
      key: 'xirr',
      label: 'XIRR',
      value: formatPctPlain(metrics.xirr),
      note: '内部收益率（年化），与 Excel XIRR 同口径，误差 <0.01%',
    },
    {
      key: 'twr',
      label: 'TWR',
      value: formatPctPlain(metrics.twr),
      note: '时间加权收益率（日链式），剥离资金进出影响',
    },
    {
      key: 'yoc',
      label: 'YOC',
      value: formatPctPlain(metrics.yoc),
      note: '成本股息率 = 近12个月分红 ÷ 持仓成本（金色）',
    },
  ];

  return (
    <Card title="收益率指标" bodyClassName="p-4">
      <div className="grid grid-cols-3 divide-x divide-line-soft">
        {items.map((it) => (
          <Tooltip key={it.key} content={it.note} side="bottom">
            <div className="px-3 first:pl-0 last:pr-0">
              <div className="text-[11px] text-secondary font-medium tracking-wider">{it.label}</div>
              <div className="num text-[22px] font-bold text-primary mt-1">{it.value}</div>
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="mt-3 pt-2 border-t border-line-soft text-[11px] text-disabled">
        预测/税务均为估算口径，悬停查看计算依据
      </div>
    </Card>
  );
}

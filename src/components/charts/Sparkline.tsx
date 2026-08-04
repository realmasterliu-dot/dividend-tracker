import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from './EChart';
import { COLORS } from '@/styles/tokens';

interface SparklineProps {
  data: number[];
  positive?: boolean;
  height?: number;
}

/** 持仓表 30 日迷你走势 */
export function Sparkline({ data, positive, height = 28 }: SparklineProps) {
  const option = useMemo<EChartsOption>(() => {
    const color = positive === undefined ? COLORS.textSecondary : positive ? COLORS.schemeUp : COLORS.schemeDown;
    return {
      animation: false,
      grid: { left: 2, right: 2, top: 4, bottom: 4 },
      xAxis: { type: 'category', show: false, data: data.map((_, i) => i) },
      yAxis: { type: 'value', show: false, scale: true },
      series: [
        {
          type: 'line',
          data,
          symbol: 'none',
          smooth: true,
          lineStyle: { color, width: 1.4 },
          areaStyle: { color: 'rgba(120,140,170,0.08)' },
        },
      ],
    } as EChartsOption;
  }, [data, positive]);

  return <EChart option={option} height={height} notMerge />;
}

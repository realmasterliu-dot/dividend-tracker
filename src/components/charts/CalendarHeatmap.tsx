import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from './EChart';
import { HeatCell } from '@/types';
import { formatMoney } from '@/lib/format';
import { COLORS } from '@/styles/tokens';

interface CalendarHeatmapProps {
  cells: HeatCell[];
  baseCurrency: 'CNY' | 'USD';
}

/** 90 天分红日历热力图（颜色深浅 = 金额，点击由外层跳转日历页） */
export function CalendarHeatmap({ cells, baseCurrency }: CalendarHeatmapProps) {
  const option = useMemo<EChartsOption>(() => {
    const max = Math.max(1, ...cells.map((c) => c.amount));
    const dates = cells.map((c) => c.date);
    const values = cells.map((c, i) => [i, 0, c.amount, c.count]);
    return {
      animation: false,
      tooltip: {
        backgroundColor: '#0E1420',
        borderColor: COLORS.borderDefault,
        textStyle: { color: COLORS.textPrimary, fontSize: 11 },
        formatter: (params: unknown) => {
          const p = params as { value: [number, number, number, number] };
          const idx = p.value[0];
          const cell = cells[idx];
          if (!cell || cell.amount === 0) return `${cell?.date ?? ''} 无分红`;
          return `${cell.date}<br/>分红 ${formatMoney(cell.amount, baseCurrency, 0)}${cell.count > 1 ? `（${cell.count} 笔）` : ''}`;
        },
      },
      grid: { left: 30, right: 8, top: 8, bottom: 24 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: COLORS.borderDefault } },
        axisLabel: {
          color: COLORS.textDisabled,
          fontSize: 9,
          interval: 9,
          formatter: (v: string) => v.slice(5).replace('-', '/'),
        },
      },
      yAxis: {
        type: 'category',
        data: ['分红'],
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
      },
      visualMap: {
        min: 0,
        max,
        show: false,
        inRange: { color: ['#1B2330', '#8a6d0a', COLORS.goldDividend] },
      },
      series: [
        {
          type: 'heatmap',
          data: values,
          label: {
            show: true,
            fontSize: 8,
            color: COLORS.textPrimary,
            formatter: (p: unknown) => {
              const v = (p as { value: [number, number, number] }).value;
              return v[2] > 0 ? '¥' : '';
            },
          },
          itemStyle: {
            borderColor: COLORS.bgPage,
            borderWidth: 1,
            borderRadius: 2,
          },
        },
      ],
    } as EChartsOption;
  }, [cells, baseCurrency]);

  return <EChart option={option} height={96} />;
}

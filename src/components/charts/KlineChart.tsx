import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from './EChart';
import { COLORS } from '@/styles/tokens';

export interface KlinePoint {
  date: string;
  open: number;
  close: number;
  low: number;
  high: number;
}

interface KlineChartProps {
  data: KlinePoint[];
  exDates: string[]; // 除权除息日标记
  currency: 'CNY' | 'USD' | 'HKD';
}

/** 标的 K 线（30/60/250 日切换，除息日标记） */
export function KlineChart({ data, exDates, currency }: KlineChartProps) {
  const option = useMemo<EChartsOption>(() => {
    const dates = data.map((d) => d.date);
    const ohlc = data.map((d) => [d.open, d.close, d.low, d.high]);
    const exSet = new Set(exDates);

    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: '#0E1420',
        borderColor: COLORS.borderDefault,
        textStyle: { color: COLORS.textPrimary, fontSize: 11 },
      },
      legend: { top: 4, textStyle: { color: COLORS.textSecondary, fontSize: 11 }, data: ['K线'] },
      grid: { left: 56, right: 16, top: 28, bottom: 24 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: COLORS.borderDefault } },
        axisLabel: { color: COLORS.textDisabled, fontSize: 10, interval: Math.max(0, Math.floor(dates.length / 8) - 1) },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: COLORS.textDisabled, fontSize: 10 },
        splitLine: { lineStyle: { color: '#1A2230' } },
      },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 2 }],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: ohlc,
          itemStyle: {
            color: COLORS.schemeUp,
            color0: COLORS.schemeDown,
            borderColor: COLORS.schemeUp,
            borderColor0: COLORS.schemeDown,
          },
          markPoint: {
            symbol: 'pin',
            symbolSize: 34,
            itemStyle: { color: COLORS.statusWarning },
            label: { color: '#0A0E14', fontSize: 9, formatter: '除息' },
            data: dates
              .map((d, i) => (exSet.has(d) ? { coord: [d, data[i].high] } : null))
              .filter(Boolean) as { coord: (string | number)[] }[],
          },
        },
      ],
    } as EChartsOption;
  }, [data, exDates]);

  return <EChart option={option} height={300} />;
}

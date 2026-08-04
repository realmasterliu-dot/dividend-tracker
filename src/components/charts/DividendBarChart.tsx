import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from './EChart';
import { COLORS } from '@/styles/tokens';

export interface DividendBarDatum {
  year: number;
  declared: number; // 已宣告实线金柱（已到账/已宣告）
  predicted: number; // 预测虚线灰柱
  special: number; // 特别股息斜纹柱
  isCurrentYear: boolean;
}

interface DividendBarChartProps {
  data: DividendBarDatum[];
  showSpecial: boolean;
}

/** 生成斜纹 pattern（特别股息标注用） */
function diagonalStripePattern(): { image: HTMLCanvasElement; repeat: 'repeat' } {
  const size = 6;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,167,38,0.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-2, size);
    ctx.lineTo(size, -2);
    ctx.stroke();
  }
  return { image: canvas, repeat: 'repeat' };
}

/** 年度分红柱状图：已收实线金柱 / 预测虚线灰柱 / 特别股息斜纹柱（PRD §3.2.6） */
export function DividendBarChart({ data, showSpecial }: DividendBarChartProps) {
  const option = useMemo<EChartsOption>(() => {
    const years = data.map((d) => String(d.year));
    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#0E1420',
        borderColor: COLORS.borderDefault,
        textStyle: { color: COLORS.textPrimary, fontSize: 11 },
      },
      legend: {
        top: 4,
        textStyle: { color: COLORS.textSecondary, fontSize: 11 },
        data: ['已到账/已宣告', '预测区间', '特别股息'],
      },
      grid: { left: 52, right: 12, top: 32, bottom: 24 },
      xAxis: {
        type: 'category',
        data: years,
        axisLine: { lineStyle: { color: COLORS.borderDefault } },
        axisLabel: { color: COLORS.textDisabled, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: COLORS.textDisabled, fontSize: 10 },
        splitLine: { lineStyle: { color: '#1A2230' } },
      },
      series: [
        {
          name: '已到账/已宣告',
          type: 'bar',
          data: data.map((d) => d.declared),
          itemStyle: { color: COLORS.goldDividend },
          barWidth: 22,
        },
        {
          name: '预测区间',
          type: 'bar',
          data: data.map((d) => d.predicted),
          itemStyle: {
            color: 'rgba(90,100,120,0.35)',
            borderColor: COLORS.statusPrediction,
            borderType: 'dashed',
            borderWidth: 1,
          },
          barWidth: 22,
        },
        ...(showSpecial
          ? [
              {
                name: '特别股息',
                type: 'bar',
                data: data.map((d) => d.special),
                itemStyle: {
                  color: {
                    type: 'pattern' as const,
                    backgroundColor: 'rgba(255,167,38,0.18)',
                    ...diagonalStripePattern(),
                  },
                },
                barWidth: 22,
              },
            ]
          : []),
      ],
    } as EChartsOption;
  }, [data, showSpecial]);

  return <EChart option={option} height={220} />;
}

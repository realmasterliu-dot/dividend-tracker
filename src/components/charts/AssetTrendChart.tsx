import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from './EChart';
import { PortfolioSnapshot } from '@/types';
import { formatMoney, formatNumber } from '@/lib/format';
import { COLORS } from '@/styles/tokens';

interface AssetTrendChartProps {
  snapshots: PortfolioSnapshot[];
  baseCurrency: 'CNY' | 'USD';
}

/** 资产走势三线（市值/累计投入/累计分红金）+ "近似重建"角注 + 数据完整度条 */
export function AssetTrendChart({ snapshots, baseCurrency }: AssetTrendChartProps) {
  const option = useMemo<EChartsOption>(() => {
    const dates = snapshots.map((s) => s.date);
    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0E1420',
        borderColor: COLORS.borderDefault,
        textStyle: { color: COLORS.textPrimary, fontSize: 11 },
        formatter: (params: unknown) => {
          const arr = params as { axisValue: string; seriesName: string; value: number; color: string }[];
          const lines = arr.map(
            (p) =>
              `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:${p.color}">${p.seriesName}</span><span class="num">${formatMoney(p.value, baseCurrency, 0)}</span></div>`,
          );
          return `<div style="font-size:11px"><b>${arr[0]?.axisValue}</b></div>${lines.join('')}`;
        },
      },
      legend: {
        top: 4,
        textStyle: { color: COLORS.textSecondary, fontSize: 11 },
        data: ['市值', '累计投入', '累计分红'],
      },
      grid: { left: 56, right: 16, top: 32, bottom: 24 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: COLORS.borderDefault } },
        axisLabel: { color: COLORS.textDisabled, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          color: COLORS.textDisabled,
          fontSize: 10,
          formatter: (v: number) => formatNumber(v / 10000, 1) + '万',
        },
        splitLine: { lineStyle: { color: '#1A2230' } },
      },
      series: [
        {
          name: '市值',
          type: 'line',
          data: snapshots.map((s) => s.marketValue),
          symbol: 'none',
          lineStyle: { color: COLORS.textPrimary, width: 1.6 },
          areaStyle: { color: 'rgba(230,234,240,0.04)' },
        },
        {
          name: '累计投入',
          type: 'line',
          data: snapshots.map((s) => s.invested),
          symbol: 'none',
          lineStyle: { color: COLORS.textSecondary, width: 1.2, type: 'dashed' },
        },
        {
          name: '累计分红',
          type: 'line',
          data: snapshots.map((s) => s.dividends),
          symbol: 'none',
          lineStyle: { color: COLORS.goldDividend, width: 2 },
          areaStyle: { color: 'rgba(240,185,11,0.05)' },
        },
      ],
    } as EChartsOption;
  }, [snapshots, baseCurrency]);

  return (
    <div>
      <EChart option={option} height={240} />
      <div className="mt-2 text-[11px] text-disabled leading-relaxed">
        <span>⚠ 历史曲线为基于建仓成本与历史行情的<span className="text-warning">近似重建</span>，非逐笔实际记录</span>
        <div className="mt-1 flex items-center gap-2">
          <span>数据完整度</span>
          <span className="num text-primary">
            {formatNumber((snapshots.reduce((s, x) => s + x.dataCompleteness, 0) / (snapshots.length || 1)) * 100, 0)}%
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-card-hover overflow-hidden max-w-[200px]">
            <div
              className="h-full bg-healthy rounded-full"
              style={{
                width: `${(snapshots.reduce((s, x) => s + x.dataCompleteness, 0) / (snapshots.length || 1)) * 100}%`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

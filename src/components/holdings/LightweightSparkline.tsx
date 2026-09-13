import React, { useMemo } from 'react';
import clsx from 'clsx';

interface LightweightSparklineProps {
  data: number[];
  positive?: boolean;
  height?: number;
}

/**
 * 只用 SVG 绘制的小趋势线。
 *
 * 持仓账本只需要辨认大致走势，不值得为此加载完整图表运行时。
 */
export function LightweightSparkline({
  data,
  positive,
  height = 64,
}: LightweightSparklineProps) {
  const points = useMemo(() => {
    const values = data.filter((value) => Number.isFinite(value) && value > 0);
    if (values.length < 2) return '';

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, Math.abs(max) * 0.002, 1e-6);

    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 27 - ((value - min) / range) * 24;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [data]);

  if (!points) {
    return <div className="grid h-16 place-items-center text-[11px] text-disabled">暂无可用行情</div>;
  }

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      role="img"
      aria-label="近 30 个行情点走势"
      className={clsx('w-full', positive === undefined ? 'text-secondary' : positive ? 'text-up' : 'text-down')}
      style={{ height }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

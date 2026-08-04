import React from 'react';
import clsx from 'clsx';
import { DividendEvent } from '@/types';

export type MarkerShape = 'RECORD' | 'EX' | 'PAY';

/**
 * ●登记日 ◆除息日 ▲到账日（PRD §8.4.3：形状区分，不只靠颜色）
 * 状态色：已宣告=青 / 已到账=金 / 预测=虚线灰
 */
export function DateMarker({ shape, status, size = 'sm' }: { shape: MarkerShape; status: DividendEvent['status']; size?: 'sm' | 'lg' }) {
  const color =
    status === 'PAID' || status === 'RECONCILED'
      ? 'text-gold'
      : status === 'DECLARED' || status === 'EX_DIVIDEND'
        ? 'text-declared'
        : 'text-prediction';

  const shapeClass =
    shape === 'RECORD' ? 'rounded-full' : shape === 'EX' ? 'rotate-45 rounded-[2px]' : '';

  const sizeClass = size === 'lg' ? 'w-2.5 h-2.5' : 'w-2 h-2';

  return (
    <span
      title={shape === 'RECORD' ? '股权登记日 ●' : shape === 'EX' ? '除权除息日 ◆' : '派息到账日 ▲'}
      className={clsx('inline-block shrink-0', sizeClass, shapeClass, color)}
      style={shape === 'PAY' ? { clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' } : undefined}
    />
  );
}

export function markerLabel(shape: MarkerShape): string {
  return shape === 'RECORD' ? '登记日' : shape === 'EX' ? '除息日' : '到账日';
}

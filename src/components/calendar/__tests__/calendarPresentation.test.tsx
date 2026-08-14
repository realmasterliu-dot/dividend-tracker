import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DateMarker } from '../DateMarker';
import { timelineAmountLabel } from '../TimelineView';

describe('日历展示', () => {
  it('日期标记使用当前状态色作为实体填充色', () => {
    const markup = renderToStaticMarkup(<DateMarker shape="PAY" status="PAID" />);
    expect(markup).toContain('background-color:currentColor');
    expect(markup).toContain('clip-path:polygon');
  });

  it('到账日按事件状态区分预计和已到账', () => {
    expect(timelineAmountLabel('PAY', 'DECLARED')).toBe('预计到账');
    expect(timelineAmountLabel('PAY', 'PAID')).toBe('已到账');
    expect(timelineAmountLabel('PAY', 'RECONCILED')).toBe('已到账');
  });
});

import { describe, expect, it } from 'vitest';
import { DividendEvent } from '@/types';
import { buildMonthGrid, classifyPending, heatmap90, markerForDate, timelineEvents } from '../calendar';
import { SEED_TODAY, addDays } from '../clock';

const TODAY = SEED_TODAY; // 2026-08-04

function mkDiv(over: Partial<DividendEvent> & { id: string }): DividendEvent {
  return {
    instrumentId: 'TEST',
    status: 'DECLARED',
    recordDate: '2026-08-15',
    exDate: '2026-08-16',
    payDate: '2026-08-20',
    payDateEstimated: true,
    perShareAmount: 1,
    currency: 'CNY',
    quantityAtRecord: 100,
    grossAmount: 0,
    taxRateApplied: 0,
    taxWithheld: 0,
    contingentTax: 0,
    netAmount: 100,
    taxBracket: 'NONE',
    dividendForm: 'CASH',
    manual: false,
    sourceKey: 'k',
    ...over,
  } as DividendEvent;
}

describe('日期标记（PRD §8.4.3：●登记日 ◆除息日 ▲到账日）', () => {
  it('markerForDate 按三个日期精确匹配', () => {
    const d = mkDiv({ id: 'd' });
    expect(markerForDate(d, '2026-08-15')).toBe('RECORD');
    expect(markerForDate(d, '2026-08-16')).toBe('EX');
    expect(markerForDate(d, '2026-08-20')).toBe('PAY');
    expect(markerForDate(d, '2026-08-17')).toBeNull();
  });

  it('buildMonthGrid：条目落在对应日期格', () => {
    const grid = buildMonthGrid([mkDiv({ id: 'd' })], 2026, 7); // 2026-08
    const cell = grid.find((c) => c.date === '2026-08-16');
    expect(cell?.items.map((i) => i.marker)).toEqual(['EX']);
    expect(grid).toHaveLength(31); // 8 月 31 天
  });
});

describe('待定区归类（PRD §3.2.1：日期未定不落具体格）', () => {
  it('PROPOSED / APPROVED 进入待定区', () => {
    const pending = classifyPending([
      mkDiv({ id: 'p', status: 'PROPOSED' }),
      mkDiv({ id: 'a', status: 'APPROVED' }),
    ]);
    expect(pending.map((p) => p.stage)).toEqual(['PROPOSED', 'APPROVED']);
  });

  it('DECLARED 但无登记/除息日期 → 仍进待定区', () => {
    const pending = classifyPending([
      mkDiv({ id: 'd', status: 'DECLARED', recordDate: undefined, exDate: undefined, payDate: undefined }),
    ]);
    expect(pending).toHaveLength(1);
    expect(pending[0].stage).toBe('APPROVED');
  });

  it('日期已确定的 DECLARED / PAID 不进待定区', () => {
    const pending = classifyPending([
      mkDiv({ id: 'd', status: 'DECLARED' }),
      mkDiv({ id: 'paid', status: 'PAID' }),
    ]);
    expect(pending).toHaveLength(0);
  });
});

describe('90 天分红热力图（PRD §8.4.1 ⑤：待定区条目不落具体日期格）', () => {
  it('PROPOSED/APPROVED 不进入热力图', () => {
    const cells = heatmap90(
      [
        mkDiv({ id: 'p', status: 'PROPOSED', payDate: addDays(TODAY, 5) }),
        mkDiv({ id: 'a', status: 'APPROVED', payDate: addDays(TODAY, 6) }),
      ],
      TODAY,
    );
    expect(cells).toHaveLength(90);
    const withAmount = cells.filter((c) => c.amount > 0);
    expect(withAmount).toHaveLength(0);
  });

  it('已宣告分红按 payDate 落到精确日期格', () => {
    const target = addDays(TODAY, 10);
    const cells = heatmap90([mkDiv({ id: 'd', status: 'DECLARED', payDate: target })], TODAY);
    const cell = cells.find((c) => c.date === target);
    expect(cell?.amount).toBeCloseTo(100, 6);
    expect(cell?.count).toBe(1);
  });

  it('90 天窗口之外（<today 或 >today+89）不入热力图', () => {
    const cells = heatmap90(
      [
        mkDiv({ id: 'past', status: 'DECLARED', payDate: addDays(TODAY, -1) }),
        mkDiv({ id: 'far', status: 'DECLARED', payDate: addDays(TODAY, 90) }),
      ],
      TODAY,
    );
    const withAmount = cells.filter((c) => c.amount > 0);
    expect(withAmount).toHaveLength(0);
  });

  it('同日多笔分红金额累加、计数累加', () => {
    const target = addDays(TODAY, 3);
    const cells = heatmap90(
      [
        mkDiv({ id: 'd1', status: 'DECLARED', payDate: target, netAmount: 100 }),
        mkDiv({ id: 'd2', status: 'EX_DIVIDEND', payDate: target, netAmount: 50 }),
      ],
      TODAY,
    );
    const cell = cells.find((c) => c.date === target);
    expect(cell?.amount).toBeCloseTo(150, 6);
    expect(cell?.count).toBe(2);
  });
});

describe('时间轴视图', () => {
  it('timelineEvents 按日期排序，含登记/除息/到账三标记', () => {
    const events = timelineEvents([mkDiv({ id: 'd' })]);
    expect(events.map((e) => e.date)).toEqual(['2026-08-15', '2026-08-16', '2026-08-20']);
    expect(events[0].items[0].marker).toBe('RECORD');
    expect(events[1].items[0].marker).toBe('EX');
    expect(events[2].items[0].marker).toBe('PAY');
  });
});

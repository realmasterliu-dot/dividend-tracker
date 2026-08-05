import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_TODAY_ENV_KEY,
  SEED_TODAY,
  addDays,
  daysBetween,
  isDemoClock,
  nowISO,
  todayISO,
  tradingDaysBetween,
} from '../clock';

/**
 * 应用时钟（src/lib/clock.ts）
 * - 默认返回真实系统日期（不再硬编码 SEED_TODAY）
 * - VITE_DEMO_TODAY 环境变量驱动演示回拨，且不污染默认行为
 * - tradingDaysBetween：交易日口径，供行情陈旧判定使用
 */

// 固定锚点（2026-08-03 为周一，便于覆盖周末跨越）
const MON = '2026-08-03';
const TUE = '2026-08-04';
const WED = '2026-08-05';
const FRI = '2026-08-07';
const SAT = '2026-08-08';
const SUN = '2026-08-09';
const NEXT_MON = '2026-08-10';

describe('默认时钟：真实系统日期', () => {
  it('锚点日期确实是预期的星期几（防止用例前提失效）', () => {
    expect(dayjs(MON).day()).toBe(1);
    expect(dayjs(FRI).day()).toBe(5);
    expect(dayjs(SAT).day()).toBe(6);
    expect(dayjs(SUN).day()).toBe(0);
    expect(dayjs(NEXT_MON).day()).toBe(1);
  });

  it('未配置 VITE_DEMO_TODAY 时 isDemoClock() 为 false', () => {
    expect(isDemoClock()).toBe(false);
  });

  it('todayISO() 返回真实系统日期（本地时区，YYYY-MM-DD）', () => {
    expect(todayISO()).toBe(dayjs().format('YYYY-MM-DD'));
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('SEED_TODAY 是 todayISO() 的进程内稳定快照', () => {
    expect(SEED_TODAY).toBe(todayISO());
  });

  it('nowISO() 返回当前真实时刻，且日期部分与 todayISO 同日（UTC 口径允许 ±1 天）', () => {
    const now = nowISO();
    expect(() => new Date(now).toISOString()).not.toThrow();
    expect(Math.abs(daysBetween(now.slice(0, 10), todayISO()))).toBeLessThanOrEqual(1);
  });

  it('环境变量名常量对外暴露，便于部署侧配置', () => {
    expect(DEMO_TODAY_ENV_KEY).toBe('VITE_DEMO_TODAY');
  });
});

describe('tradingDaysBetween（不含周末，区间左开右闭）', () => {
  it('同一天 → 0', () => {
    expect(tradingDaysBetween(WED, WED)).toBe(0);
  });

  it('相邻交易日 → 1', () => {
    expect(tradingDaysBetween(MON, TUE)).toBe(1);
    expect(tradingDaysBetween(TUE, WED)).toBe(1);
  });

  it('★周五收盘 → 周一：交易日间隔为 1（日历 3 天）', () => {
    expect(daysBetween(FRI, NEXT_MON)).toBe(3);
    expect(tradingDaysBetween(FRI, NEXT_MON)).toBe(1);
  });

  it('周五 → 周六 / 周日：交易日间隔为 0', () => {
    expect(tradingDaysBetween(FRI, SAT)).toBe(0);
    expect(tradingDaysBetween(FRI, SUN)).toBe(0);
  });

  it('整周：周一 → 周五 为 4 个交易日', () => {
    expect(tradingDaysBetween(MON, FRI)).toBe(4);
  });

  it('跨两周：周一 → 次次周五 为 9 个交易日', () => {
    expect(tradingDaysBetween(MON, '2026-08-14')).toBe(9);
  });

  it('结束日早于起始日 → 0（不返回负数）', () => {
    expect(tradingDaysBetween(NEXT_MON, FRI)).toBe(0);
    expect(tradingDaysBetween(WED, MON)).toBe(0);
  });

  it('跨月与跨年仍按自然周历计数', () => {
    // 2026-12-31 周四 → 2027-01-04 周一：(12-31, 01-04] 含 1/1(五) 1/4(一) = 2
    expect(dayjs('2026-12-31').day()).toBe(4);
    expect(tradingDaysBetween('2026-12-31', '2027-01-04')).toBe(2);
  });

  it('与日历天口径的差异恰为周末天数', () => {
    // 周一 → 次周一：日历 7 天，交易日 5 天
    expect(daysBetween(MON, NEXT_MON)).toBe(7);
    expect(tradingDaysBetween(MON, NEXT_MON)).toBe(5);
  });

  it('48h 陈旧阈值语义：周五数据在周一不告警，在周二才告警', () => {
    const stale = (from: string, to: string) => tradingDaysBetween(from, to) * 24 >= 48;
    expect(stale(FRI, NEXT_MON)).toBe(false); // 周一：仅 1 个交易日
    expect(stale(FRI, '2026-08-11')).toBe(true); // 周二：2 个交易日
  });
});

describe('演示回拨 VITE_DEMO_TODAY（不污染默认行为）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('配置合法日期后全局回拨：todayISO / SEED_TODAY / nowISO 一致生效', async () => {
    vi.stubEnv('VITE_DEMO_TODAY', '2026-01-15');
    const clock = await import('../clock');

    expect(clock.isDemoClock()).toBe(true);
    expect(clock.todayISO()).toBe('2026-01-15');
    expect(clock.SEED_TODAY).toBe('2026-01-15');
    expect(clock.nowISO()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('回拨后依赖时钟的推导同步生效（addDays / daysBetween 以回拨日为基准）', async () => {
    vi.stubEnv('VITE_DEMO_TODAY', '2026-01-15');
    const clock = await import('../clock');
    expect(clock.addDays(clock.todayISO(), 1)).toBe('2026-01-16');
    expect(clock.daysBetween('2026-01-10', clock.todayISO())).toBe(5);
  });

  it.each(['', 'not-a-date', '2026/01/15', '20260115', '2026-1-5', 'null'])(
    '非法格式 %o 被忽略，回落真实系统日期',
    async (raw) => {
      vi.stubEnv('VITE_DEMO_TODAY', raw);
      const clock = await import('../clock');
      expect(clock.isDemoClock()).toBe(false);
      expect(clock.todayISO()).toBe(dayjs().format('YYYY-MM-DD'));
    },
  );

  it('取消回拨后重新加载模块 → 恢复真实系统日期（无残留污染）', async () => {
    vi.stubEnv('VITE_DEMO_TODAY', '2026-01-15');
    const demo = await import('../clock');
    expect(demo.todayISO()).toBe('2026-01-15');

    vi.unstubAllEnvs();
    vi.resetModules();
    const real = await import('../clock');
    expect(real.isDemoClock()).toBe(false);
    expect(real.todayISO()).toBe(dayjs().format('YYYY-MM-DD'));
  });

  it('回拨不影响纯日期工具函数的语义', async () => {
    vi.stubEnv('VITE_DEMO_TODAY', '2026-01-15');
    const clock = await import('../clock');
    // 显式传参的函数与回拨无关
    expect(clock.tradingDaysBetween(FRI, NEXT_MON)).toBe(1);
    expect(clock.addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('addDays / daysBetween 边界（回归）', () => {
  it('daysBetween 按自然日差值，支持负数', () => {
    expect(daysBetween(MON, FRI)).toBe(4);
    expect(daysBetween(FRI, MON)).toBe(-4);
    expect(daysBetween(WED, WED)).toBe(0);
  });

  it('addDays 跨月 / 跨年 / 闰年', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29'); // 闰年
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

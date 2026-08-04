import dayjs from 'dayjs';

/**
 * 演示时钟 —— 全应用统一时间基准（种子数据、税务、日历、预测共用）。
 * 接入真实数据管道后，将 SEED_TODAY 替换为真实系统日期即可（数据会随真实时钟演进）。
 */
export const SEED_TODAY = '2026-08-04';

export function todayISO(): string {
  return SEED_TODAY;
}

export function nowISO(): string {
  return `${SEED_TODAY}T07:00:00Z`;
}

export function parseISO(date: string): dayjs.Dayjs {
  return dayjs(date);
}

export function daysBetween(a: string, b: string): number {
  return dayjs(b).startOf('day').diff(dayjs(a).startOf('day'), 'day');
}

export function addDays(date: string, days: number): string {
  return dayjs(date).add(days, 'day').format('YYYY-MM-DD');
}

export function addMonths(date: string, months: number): string {
  return dayjs(date).add(months, 'month').format('YYYY-MM-DD');
}

export function formatDate(date: string): string {
  return dayjs(date).format('YYYY-MM-DD');
}

/** 本地时区取年（★时区安全：避免 new Date('YYYY-MM-DD').getFullYear() 在负偏移时区错年） */
export function yearOf(date: string): number {
  return dayjs(date).year();
}

export function formatDateShort(date: string): string {
  return dayjs(date).format('MM-DD');
}

export function isBefore(a: string, b: string): boolean {
  return dayjs(a).isBefore(dayjs(b), 'day');
}

export function isSameOrBefore(a: string, b: string): boolean {
  return dayjs(a).isSame(dayjs(b), 'day') || dayjs(a).isBefore(dayjs(b), 'day');
}

/** 简单唯一 id（本地演示用途） */
export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

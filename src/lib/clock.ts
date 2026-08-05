import dayjs from 'dayjs';

/**
 * 应用时钟 —— 全应用统一时间基准（行情、税务、日历、预测、通知共用）。
 *
 * 默认返回**真实系统日期**。若需要演示回拨（例如复现某天的截图），
 * 设置环境变量 `VITE_DEMO_TODAY='YYYY-MM-DD'` 即可全局回拨，不改代码。
 */

/** 演示回拨环境变量名（默认不设置 → 使用真实系统时间） */
export const DEMO_TODAY_ENV_KEY = 'VITE_DEMO_TODAY';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 读取演示回拨日期；未配置或格式非法时返回空串（= 使用真实时间） */
function readDemoOverride(): string {
  try {
    const env = import.meta.env as Record<string, unknown> | undefined;
    const raw = env?.[DEMO_TODAY_ENV_KEY];
    return typeof raw === 'string' && ISO_DATE_RE.test(raw) ? raw : '';
  } catch {
    // 非 Vite 运行时（如纯 Node 脚本）无 import.meta.env → 使用真实时间
    return '';
  }
}

const DEMO_TODAY: string = readDemoOverride();

/** 是否处于演示回拨模式（UI 可据此提示"时间已回拨"） */
export function isDemoClock(): boolean {
  return DEMO_TODAY !== '';
}

/**
 * 今天（本地时区，'YYYY-MM-DD'）。
 * ★时区安全：用 dayjs 本地日历格式化，避免 toISOString() 在东八区/负偏移时区错日。
 */
export function todayISO(): string {
  return DEMO_TODAY || dayjs().format('YYYY-MM-DD');
}

/** 当前时刻（UTC ISO 字符串） */
export function nowISO(): string {
  return DEMO_TODAY ? `${DEMO_TODAY}T00:00:00.000Z` : dayjs().toISOString();
}

/**
 * 模块加载时刻的"今天"快照。
 * 供种子数据生成器与单元测试使用（需要一个在整个进程内稳定不变的基准日）。
 * 业务代码请直接调用 todayISO()。
 */
export const SEED_TODAY: string = todayISO();

export function parseISO(date: string): dayjs.Dayjs {
  return dayjs(date);
}

export function daysBetween(a: string, b: string): number {
  return dayjs(b).startOf('day').diff(dayjs(a).startOf('day'), 'day');
}

export function addDays(date: string, days: number): string {
  return dayjs(date).add(days, 'day').format('YYYY-MM-DD');
}

/**
 * 两个日期之间的「交易日」数（不含周末，区间左开右闭 (a, b]）。
 * 用于行情陈旧判定：避免「昨夜收盘 / 周末无交易」被误判为数据陈旧。
 * 例：周五收盘（a）到周一（b）交易日的间隔为 1（仅周一），而非日历 3 天。
 */
export function tradingDaysBetween(a: string, b: string): number {
  let count = 0;
  let cursor = dayjs(a).startOf('day').add(1, 'day');
  const end = dayjs(b).startOf('day');
  while (!cursor.isAfter(end, 'day')) {
    const dow = cursor.day();
    if (dow !== 0 && dow !== 6) count += 1;
    cursor = cursor.add(1, 'day');
  }
  return count;
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

/**
 * 日期比较（「日」粒度）：a < b → -1，a === b → 0，a > b → 1。
 *
 * ★性能：ISO 'YYYY-MM-DD' 走字典序快路径 —— 该格式下字典序恒等于时间序，
 * 可避免在快照重建、forward-fill 等热点路径上为每次比较构造两个 dayjs 对象。
 * 非 ISO 输入回退 dayjs，保证语义与原实现完全一致。
 */
export function compareDates(a: string, b: string): number {
  if (ISO_DATE_RE.test(a) && ISO_DATE_RE.test(b)) {
    if (a < b) return -1;
    return a > b ? 1 : 0;
  }
  const left = dayjs(a).startOf('day');
  const right = dayjs(b).startOf('day');
  if (left.isBefore(right)) return -1;
  return left.isAfter(right) ? 1 : 0;
}

export function isBefore(a: string, b: string): boolean {
  return compareDates(a, b) < 0;
}

export function isSameOrBefore(a: string, b: string): boolean {
  return compareDates(a, b) <= 0;
}

/** 简单唯一 id（本地演示用途） */
export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

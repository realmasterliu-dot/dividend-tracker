import dayjs from 'dayjs';
import {
  DataState,
  DividendEvent,
  Notification,
  NotificationType,
  PlanFrequency,
} from '@/types';
import { addDays, daysBetween, todayISO } from './clock';

/**
 * NotificationService（architecture.md 类图）
 * 触发规则 + dedup key 生成；已存在 key 不重复推送。
 */

export function dedupKey(type: NotificationType, instrumentId: string, date: string): string {
  return `${instrumentId}|${type}|${date}`;
}

function push(
  out: Notification[],
  seen: Set<string>,
  n: Omit<Notification, 'id' | 'read'>,
): void {
  if (seen.has(n.key)) return;
  seen.add(n.key);
  out.push({ ...n, id: `gen-${n.key}`, read: false });
}

export function generate(state: DataState, stalenessThresholdHours: number, today = todayISO()): Notification[] {
  const out: Notification[] = [];
  const seen = new Set(state.notifications.map((n) => n.key));
  const instrumentById = new Map(state.instruments.map((i) => [i.id, i]));

  // 分红事件：预案 / 日期确定 / 登记日临近 / 除息日 / 到账日
  for (const d of state.dividends) {
    const inst = instrumentById.get(d.instrumentId);
    const name = inst?.name ?? d.instrumentId;
    const amountText = `约 ¥${d.netAmount.toFixed(0)}`;

    if (d.status === 'PROPOSED') {
      push(out, seen, {
        key: dedupKey('DIVIDEND_PROPOSED', d.instrumentId, d.announceDate ?? d.id),
        type: 'DIVIDEND_PROPOSED',
        title: `${name} 发布分红预案`,
        body: `预计分红 ${amountText}，股权登记日待公告（方案进度：董事会预案）`,
        severity: 'INFO',
        createdAt: today,
        relatedInstrumentId: d.instrumentId,
      });
    }
    if (d.status === 'DECLARED' || d.status === 'EX_DIVIDEND') {
      if (d.recordDate) {
        const gap = daysBetween(today, d.recordDate);
        if (gap === 1) {
          push(out, seen, {
            key: dedupKey('RECORD_DATE_CLOSE', d.instrumentId, d.recordDate),
            type: 'RECORD_DATE_CLOSE',
            title: `${name} 明日股权登记`,
            body: `登记日 ${d.recordDate}，收盘持有即享分红 ${amountText}`,
            severity: 'WARN',
            createdAt: today,
            relatedInstrumentId: d.instrumentId,
          });
        }
      }
      if (d.exDate) {
        const gap = daysBetween(today, d.exDate);
        if (gap === 0) {
          push(out, seen, {
            key: dedupKey('EX_DATE', d.instrumentId, d.exDate),
            type: 'EX_DATE',
            title: `${name} 今日除权除息`,
            body: `除息日 ${d.exDate}，预计分红 ${amountText}`,
            severity: 'INFO',
            createdAt: today,
            relatedInstrumentId: d.instrumentId,
          });
        }
      }
      if (d.payDate) {
        const gap = daysBetween(today, d.payDate);
        if (gap >= 0 && gap <= 3) {
          push(out, seen, {
            key: dedupKey('PAY_DATE', d.instrumentId, d.payDate),
            type: 'PAY_DATE',
            title: `${name} 分红即将到账`,
            body: `${gap === 0 ? '今日' : `${gap} 天后`}到账，预计 ${amountText}（到账日${d.payDateEstimated ? '为估算' : ''}）`,
            severity: gap === 0 ? 'INFO' : 'WARN',
            createdAt: today,
            relatedInstrumentId: d.instrumentId,
          });
        }
      }
    }
  }

  // 定投 PENDING 超过 7 天未确认
  for (const tx of state.transactions) {
    if (tx.status !== 'PENDING') continue;
    const age = daysBetween(tx.date, today);
    if (age >= 7) {
      push(out, seen, {
        key: dedupKey('DCA_PENDING', tx.instrumentId, tx.id),
        type: 'DCA_PENDING',
        title: '定投流水待确认',
        body: `${tx.instrumentId} ${tx.date} 的流水已 ${age} 天未确认，请核对实际成交份额`,
        severity: 'WARN',
        createdAt: today,
        relatedInstrumentId: tx.instrumentId,
      });
    }
  }

  // 数据陈旧：最新价格超过阈值
  for (const inst of state.instruments) {
    const snaps = state.prices.filter((p) => p.instrumentId === inst.id);
    if (snaps.length === 0) continue;
    const latest = snaps.reduce((a, b) => (a.date > b.date ? a : b));
    const hours = daysBetween(latest.date, today) * 24;
    if (hours >= stalenessThresholdHours) {
      push(out, seen, {
        key: dedupKey('DATA_STALE', inst.id, latest.date),
        type: 'DATA_STALE',
        title: `${inst.name} 价格数据陈旧`,
        body: `最新价格 ${latest.date}，已 ${daysBetween(latest.date, today)} 天未更新（阈值 ${stalenessThresholdHours}h）`,
        severity: 'ERROR',
        createdAt: today,
        relatedInstrumentId: inst.id,
      });
    }
  }

  return out;
}

export function frequencyLabel(frequency: PlanFrequency): string {
  switch (frequency) {
    case 'DAILY':
      return '每日';
    case 'WEEKLY':
      return '每周';
    case 'BIWEEKLY':
      return '每两周';
    case 'MONTHLY':
      return '每月';
  }
}

export function nextRunAfter(date: string, frequency: PlanFrequency, executionDay: number): string {
  // 简化排期：周/月频率按 executionDay 推算下一执行日
  switch (frequency) {
    case 'DAILY':
      return addDays(date, 1);
    case 'WEEKLY':
    case 'BIWEEKLY': {
      const step = frequency === 'WEEKLY' ? 7 : 14;
      return addDays(date, step);
    }
    case 'MONTHLY': {
      // ★ 时区安全：用 dayjs 本地日历运算 + 本地格式化（避免 toISOString 按 UTC 序列化少一天）
      const base = dayjs(date);
      const target = base.add(1, 'month');
      // 月末顺延策略（PRD §5.4）：31 号在小月顺延至当月最后一日（后续交易日调整由排期层处理）
      const day = Math.min(executionDay, target.daysInMonth());
      return target.date(day).format('YYYY-MM-DD');
    }
  }
}

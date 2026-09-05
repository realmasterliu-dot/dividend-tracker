import { describe, expect, it } from 'vitest';
import {
  formatNotificationTime,
  notificationSeverityLabel,
  notificationTypeLabel,
} from '../NotificationCenter';

describe('通知中文展示', () => {
  it('严重程度和通知类型不暴露英文枚举', () => {
    expect(notificationSeverityLabel.INFO).toBe('提醒');
    expect(notificationSeverityLabel.WARN).toBe('注意');
    expect(notificationSeverityLabel.ERROR).toBe('异常');
    expect(notificationTypeLabel.DCA_PENDING).toBe('定投待确认');
    expect(notificationTypeLabel.DATA_STALE).toBe('数据更新延迟');
  });

  it('时间使用中文日期格式', () => {
    expect(formatNotificationTime('2026-08-12T09:05:00.000Z')).toBe('2026年8月12日 09:05');
    expect(formatNotificationTime('2026-08-12')).toBe('2026年8月12日');
    expect(formatNotificationTime('无法解析')).toBe('无法解析');
  });
});

import { Currency, DividendEvent, DividendStatus } from '@/types';

/**
 * 种子分红事件：覆盖状态机全链路 PROPOSED→APPROVED→DECLARED→EX_DIVIDEND→PAID→RECONCILED
 * 金额字段（gross/tax/contingent/net）由 TaxEngine 推导，seed 只存事实字段。
 */

interface DivInput {
  id: string;
  instrumentId: string;
  status: DividendStatus;
  announceDate?: string;
  recordDate?: string;
  exDate?: string;
  payDate?: string;
  payDateEstimated?: boolean;
  perShareAmount: number;
  currency: Currency;
  quantityAtRecord: number;
  dividendForm?: DividendEvent['dividendForm'];
  isSpecial?: boolean;
  isEstimate?: boolean;
  manual?: boolean;
  actualReceived?: number;
}

function div(input: DivInput): DividendEvent {
  return {
    id: input.id,
    instrumentId: input.instrumentId,
    status: input.status,
    announceDate: input.announceDate,
    recordDate: input.recordDate,
    exDate: input.exDate,
    payDate: input.payDate,
    payDateEstimated: input.payDateEstimated ?? false,
    perShareAmount: input.perShareAmount,
    currency: input.currency,
    quantityAtRecord: input.quantityAtRecord,
    grossAmount: 0,
    taxRateApplied: 0,
    taxWithheld: 0,
    contingentTax: 0,
    netAmount: 0,
    actualReceived: input.actualReceived,
    taxBracket: 'NONE',
    dividendForm: input.dividendForm ?? 'CASH',
    isSpecial: input.isSpecial ?? false,
    isEstimate: input.isEstimate ?? false,
    manual: input.manual ?? false,
    sourceKey: `${input.instrumentId}|${input.payDate ?? input.exDate ?? input.recordDate ?? input.id}`,
  };
}

export const seedDividends: DividendEvent[] = [
  // ===== 600519.SH 贵州茅台（年度 + 特别股息 + 中期预案待定） =====
  div({ id: 'div-600519-2023', instrumentId: '600519.SH', status: 'PAID', announceDate: '2023-03-30', recordDate: '2023-06-29', exDate: '2023-06-30', payDate: '2023-06-30', perShareAmount: 25.9, currency: 'CNY', quantityAtRecord: 100 }),
  div({ id: 'div-600519-2024', instrumentId: '600519.SH', status: 'PAID', announceDate: '2024-04-02', recordDate: '2024-06-27', exDate: '2024-06-28', payDate: '2024-06-28', perShareAmount: 30.876, currency: 'CNY', quantityAtRecord: 100, isSpecial: true }),
  div({ id: 'div-600519-2025', instrumentId: '600519.SH', status: 'RECONCILED', announceDate: '2025-04-08', recordDate: '2025-06-26', exDate: '2025-06-27', payDate: '2025-06-27', perShareAmount: 27.64, currency: 'CNY', quantityAtRecord: 120, actualReceived: 3316.8 }),
  div({ id: 'div-600519-2026-mid', instrumentId: '600519.SH', status: 'DECLARED', announceDate: '2026-08-01', recordDate: '2026-09-10', exDate: '2026-09-11', payDate: '2026-09-14', payDateEstimated: true, perShareAmount: 23.88, currency: 'CNY', quantityAtRecord: 140 }),
  div({ id: 'div-600519-2026-prop', instrumentId: '600519.SH', status: 'PROPOSED', announceDate: '2026-03-30', perShareAmount: 20.0, currency: 'CNY', quantityAtRecord: 140 }),

  // ===== 000001.SZ 平安银行（送转后数量 ×1.2 + 已回填校准 + 中期待定） =====
  div({ id: 'div-000001-2024', instrumentId: '000001.SZ', status: 'PAID', announceDate: '2024-03-15', recordDate: '2024-07-12', exDate: '2024-07-15', payDate: '2024-07-15', perShareAmount: 0.55, currency: 'CNY', quantityAtRecord: 2000 }),
  div({ id: 'div-000001-2025', instrumentId: '000001.SZ', status: 'RECONCILED', announceDate: '2025-03-20', recordDate: '2025-08-06', exDate: '2025-08-07', payDate: '2025-08-08', perShareAmount: 0.6, currency: 'CNY', quantityAtRecord: 2400, actualReceived: 1440 }),
  div({ id: 'div-000001-2026-mid', instrumentId: '000001.SZ', status: 'DECLARED', announceDate: '2026-08-02', recordDate: '2026-10-15', exDate: '2026-10-16', payDate: '2026-10-20', payDateEstimated: true, perShareAmount: 0.3, currency: 'CNY', quantityAtRecord: 3200 }),
  div({ id: 'div-000001-2026-appr', instrumentId: '000001.SZ', status: 'APPROVED', announceDate: '2026-06-05', perShareAmount: 0.28, currency: 'CNY', quantityAtRecord: 3200 }),

  // ===== 00700.HK 腾讯控股（半年派息，香港本地券商 0% 税） =====
  div({ id: 'div-00700-2023a', instrumentId: '00700.HK', status: 'PAID', announceDate: '2023-03-22', recordDate: '2023-05-18', exDate: '2023-05-19', payDate: '2023-06-05', payDateEstimated: true, perShareAmount: 2.4, currency: 'HKD', quantityAtRecord: 200 }),
  div({ id: 'div-00700-2023b', instrumentId: '00700.HK', status: 'PAID', announceDate: '2023-08-16', recordDate: '2023-11-16', exDate: '2023-11-17', payDate: '2023-12-05', payDateEstimated: true, perShareAmount: 3.0, currency: 'HKD', quantityAtRecord: 200 }),
  div({ id: 'div-00700-2024a', instrumentId: '00700.HK', status: 'PAID', announceDate: '2024-03-20', recordDate: '2024-05-16', exDate: '2024-05-17', payDate: '2024-06-05', payDateEstimated: true, perShareAmount: 3.4, currency: 'HKD', quantityAtRecord: 200 }),
  div({ id: 'div-00700-2024b', instrumentId: '00700.HK', status: 'PAID', announceDate: '2024-08-14', recordDate: '2024-11-14', exDate: '2024-11-15', payDate: '2024-12-05', payDateEstimated: true, perShareAmount: 3.6, currency: 'HKD', quantityAtRecord: 200 }),
  div({ id: 'div-00700-2025a', instrumentId: '00700.HK', status: 'PAID', announceDate: '2025-03-19', recordDate: '2025-05-15', exDate: '2025-05-16', payDate: '2025-06-05', payDateEstimated: true, perShareAmount: 4.0, currency: 'HKD', quantityAtRecord: 200 }),
  div({ id: 'div-00700-2025b', instrumentId: '00700.HK', status: 'PAID', announceDate: '2025-08-14', recordDate: '2025-11-13', exDate: '2025-11-14', payDate: '2025-11-28', payDateEstimated: true, perShareAmount: 4.2, currency: 'HKD', quantityAtRecord: 300 }),
  div({ id: 'div-00700-2026a', instrumentId: '00700.HK', status: 'EX_DIVIDEND', announceDate: '2026-07-01', recordDate: '2026-07-30', exDate: '2026-07-31', payDate: '2026-08-15', payDateEstimated: true, perShareAmount: 4.0, currency: 'HKD', quantityAtRecord: 300 }),
  div({ id: 'div-00700-2026b', instrumentId: '00700.HK', status: 'DECLARED', announceDate: '2026-08-03', recordDate: '2026-10-05', exDate: '2026-10-06', payDate: '2026-10-20', payDateEstimated: true, perShareAmount: 4.5, currency: 'HKD', quantityAtRecord: 300 }),

  // ===== AAPL（季度派息，美股 W-8BEN 未填 30% 保守档） =====
  div({ id: 'div-aapl-2023q1', instrumentId: 'AAPL', status: 'PAID', recordDate: '2023-05-10', exDate: '2023-05-11', payDate: '2023-05-18', perShareAmount: 0.24, currency: 'USD', quantityAtRecord: 20 }),
  div({ id: 'div-aapl-2023q2', instrumentId: 'AAPL', status: 'PAID', recordDate: '2023-08-09', exDate: '2023-08-10', payDate: '2023-08-17', perShareAmount: 0.24, currency: 'USD', quantityAtRecord: 20 }),
  div({ id: 'div-aapl-2023q3', instrumentId: 'AAPL', status: 'PAID', recordDate: '2023-11-08', exDate: '2023-11-09', payDate: '2023-11-16', perShareAmount: 0.24, currency: 'USD', quantityAtRecord: 20 }),
  div({ id: 'div-aapl-2024q1', instrumentId: 'AAPL', status: 'PAID', recordDate: '2024-02-07', exDate: '2024-02-08', payDate: '2024-02-15', perShareAmount: 0.24, currency: 'USD', quantityAtRecord: 20 }),
  div({ id: 'div-aapl-2024q2', instrumentId: 'AAPL', status: 'PAID', recordDate: '2024-05-08', exDate: '2024-05-09', payDate: '2024-05-16', perShareAmount: 0.25, currency: 'USD', quantityAtRecord: 20 }),
  div({ id: 'div-aapl-2024q3', instrumentId: 'AAPL', status: 'PAID', recordDate: '2024-08-07', exDate: '2024-08-08', payDate: '2024-08-15', perShareAmount: 0.25, currency: 'USD', quantityAtRecord: 20 }),
  div({ id: 'div-aapl-2024q4', instrumentId: 'AAPL', status: 'PAID', recordDate: '2024-11-06', exDate: '2024-11-07', payDate: '2024-11-14', perShareAmount: 0.25, currency: 'USD', quantityAtRecord: 30 }),
  div({ id: 'div-aapl-2025q1', instrumentId: 'AAPL', status: 'PAID', recordDate: '2025-02-05', exDate: '2025-02-06', payDate: '2025-02-13', perShareAmount: 0.25, currency: 'USD', quantityAtRecord: 30 }),
  div({ id: 'div-aapl-2025q2', instrumentId: 'AAPL', status: 'PAID', recordDate: '2025-05-07', exDate: '2025-05-08', payDate: '2025-05-15', perShareAmount: 0.25, currency: 'USD', quantityAtRecord: 30 }),
  div({ id: 'div-aapl-2025q3', instrumentId: 'AAPL', status: 'PAID', recordDate: '2025-08-06', exDate: '2025-08-07', payDate: '2025-08-14', perShareAmount: 0.25, currency: 'USD', quantityAtRecord: 30 }),
  div({ id: 'div-aapl-2025q4', instrumentId: 'AAPL', status: 'PAID', recordDate: '2025-11-05', exDate: '2025-11-06', payDate: '2025-11-13', perShareAmount: 0.25, currency: 'USD', quantityAtRecord: 30 }),
  div({ id: 'div-aapl-2026q1', instrumentId: 'AAPL', status: 'PAID', recordDate: '2026-02-04', exDate: '2026-02-05', payDate: '2026-02-12', perShareAmount: 0.25, currency: 'USD', quantityAtRecord: 30 }),
  div({ id: 'div-aapl-2026q2', instrumentId: 'AAPL', status: 'DECLARED', recordDate: '2026-08-06', exDate: '2026-08-07', payDate: '2026-08-13', perShareAmount: 0.26, currency: 'USD', quantityAtRecord: 30 }),

  // ===== 110011 基金（年度分红，个人暂不征税） =====
  div({ id: 'div-110011-2023', instrumentId: '110011', status: 'PAID', announceDate: '2023-12-05', recordDate: '2023-12-19', exDate: '2023-12-20', payDate: '2023-12-21', perShareAmount: 0.18, currency: 'CNY', quantityAtRecord: 5000 }),
  div({ id: 'div-110011-2024', instrumentId: '110011', status: 'PAID', announceDate: '2024-12-05', recordDate: '2024-12-18', exDate: '2024-12-19', payDate: '2024-12-20', perShareAmount: 0.2, currency: 'CNY', quantityAtRecord: 5080, isEstimate: true }),
  div({ id: 'div-110011-2025', instrumentId: '110011', status: 'RECONCILED', announceDate: '2025-12-04', recordDate: '2025-12-17', exDate: '2025-12-18', payDate: '2025-12-19', perShareAmount: 0.16, currency: 'CNY', quantityAtRecord: 7080, actualReceived: 1132.8 }),
  div({ id: 'div-110011-2026', instrumentId: '110011', status: 'DECLARED', announceDate: '2026-08-04', recordDate: '2026-09-25', exDate: '2026-09-26', payDate: '2026-09-29', payDateEstimated: true, perShareAmount: 0.15, currency: 'CNY', quantityAtRecord: 7080 }),
];

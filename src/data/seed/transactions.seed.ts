import { Currency, Transaction } from '@/types';
import { SEED_TODAY } from '@/lib/clock';

/**
 * 种子流水：覆盖全部 11 种类型 + CONFIRMED/PENDING 状态
 * 金额均为标的币种；fxRate 为交易日 → 本位币(CNY)汇率。
 */

interface TxInput {
  id: string;
  instrumentId: string;
  type: Transaction['type'];
  date: string;
  quantity: number;
  price: number;
  amount?: number;
  fee?: number;
  currency: Currency;
  fxRate: number;
  status?: Transaction['status'];
  note?: string;
  source?: Transaction['source'];
  meta?: Record<string, unknown>;
}

function tx(input: TxInput): Transaction {
  return {
    id: input.id,
    instrumentId: input.instrumentId,
    type: input.type,
    status: input.status ?? 'CONFIRMED',
    date: input.date,
    quantity: input.quantity,
    price: input.price,
    amount: input.amount ?? Math.abs(input.quantity * input.price),
    fee: input.fee,
    currency: input.currency,
    fxRate: input.fxRate,
    note: input.note,
    source: input.source,
    meta: input.meta,
  };
}

export const seedTransactions: Transaction[] = [
  // ===== A股 · 600519.SH 贵州茅台 =====
  tx({ id: 'tx-600519-buy1', instrumentId: '600519.SH', type: 'BUY', date: '2023-03-15', quantity: 100, price: 1700, currency: 'CNY', fxRate: 1, note: '建仓' }),
  tx({ id: 'tx-600519-buy2', instrumentId: '600519.SH', type: 'BUY', date: '2024-06-10', quantity: 50, price: 1450, currency: 'CNY', fxRate: 1, note: '加仓' }),
  tx({ id: 'tx-600519-sell1', instrumentId: '600519.SH', type: 'SELL', date: '2025-05-20', quantity: -30, price: 1520, currency: 'CNY', fxRate: 1, note: '部分止盈（FIFO 演示）' }),
  tx({ id: 'tx-600519-buy3', instrumentId: '600519.SH', type: 'BUY', date: '2025-08-10', quantity: 20, price: 1420, currency: 'CNY', fxRate: 1, note: '满 1 年前 6 天（税档提醒演示）' }),

  // ===== A股 · 000001.SZ 平安银行（送转演示 + 近期批次演示三态税档） =====
  tx({ id: 'tx-000001-buy1', instrumentId: '000001.SZ', type: 'BUY', date: '2024-08-01', quantity: 2000, price: 10.5, currency: 'CNY', fxRate: 1 }),
  tx({
    id: 'tx-000001-bonus1',
    instrumentId: '000001.SZ',
    type: 'BONUS',
    date: '2025-06-30',
    quantity: 0,
    price: 0,
    currency: 'CNY',
    fxRate: 1,
    note: '每10股送2股 → 数量×1.2，成本摊薄，持股期限起算日不变',
    meta: { ratio: 1.2 },
  }),
  tx({ id: 'tx-000001-buy2', instrumentId: '000001.SZ', type: 'BUY', date: '2026-01-20', quantity: 500, price: 11.2, currency: 'CNY', fxRate: 1, note: '1个月-1年档（10%）演示' }),
  tx({ id: 'tx-000001-buy3', instrumentId: '000001.SZ', type: 'BUY', date: '2026-07-20', quantity: 300, price: 11.5, currency: 'CNY', fxRate: 1, note: '≤1个月档（20%）演示' }),

  // ===== 港股 · 00700.HK 腾讯控股 =====
  tx({ id: 'tx-00700-buy1', instrumentId: '00700.HK', type: 'BUY', date: '2023-11-20', quantity: 200, price: 310, currency: 'HKD', fxRate: 0.92 }),
  tx({ id: 'tx-00700-buy2', instrumentId: '00700.HK', type: 'BUY', date: '2025-01-15', quantity: 100, price: 380, currency: 'HKD', fxRate: 0.91 }),
  tx({ id: 'tx-00700-fee1', instrumentId: '00700.HK', type: 'FEE', date: '2024-12-31', quantity: 0, price: 0, amount: 30, currency: 'HKD', fxRate: 0.92, note: '券商月费' }),

  // ===== 美股 · AAPL =====
  tx({ id: 'tx-aapl-buy1', instrumentId: 'AAPL', type: 'BUY', date: '2023-09-01', quantity: 20, price: 185, currency: 'USD', fxRate: 7.2 }),
  tx({ id: 'tx-aapl-buy2', instrumentId: 'AAPL', type: 'BUY', date: '2024-12-10', quantity: 10, price: 235, currency: 'USD', fxRate: 7.28 }),
  tx({ id: 'tx-aapl-fee1', instrumentId: 'AAPL', type: 'FEE', date: '2025-12-31', quantity: 0, price: 0, amount: 3, currency: 'USD', fxRate: 7.25, note: '账户年费' }),

  // ===== 基金 · 110011 易方达优质精选（红利再投 + 定投 PENDING 演示） =====
  tx({ id: 'tx-110011-buy1', instrumentId: '110011', type: 'BUY', date: '2023-06-01', quantity: 5000, price: 3.2, currency: 'CNY', fxRate: 1 }),
  tx({
    id: 'tx-110011-reinvest1',
    instrumentId: '110011',
    type: 'DIVIDEND_REINVEST',
    date: '2024-03-25',
    quantity: 80,
    price: 3.0,
    currency: 'CNY',
    fxRate: 1,
    note: '红利再投（估算份额，可手动修正）',
    meta: { estimated: true, dividendId: 'div-110011-2023' },
  }),
  tx({ id: 'tx-110011-buy2', instrumentId: '110011', type: 'BUY', date: '2025-01-10', quantity: 2000, price: 3.5, currency: 'CNY', fxRate: 1 }),
  tx({ id: 'tx-110011-div-cash', instrumentId: '110011', type: 'DIVIDEND_CASH', date: '2025-12-19', quantity: 0, price: 0, amount: 1132.8, currency: 'CNY', fxRate: 1, note: '2025 年度现金分红到账' }),
  tx({
    id: 'tx-110011-dca-pending',
    instrumentId: '110011',
    type: 'BUY',
    status: 'PENDING',
    date: '2026-08-01',
    quantity: 0,
    price: 0,
    amount: 1000,
    currency: 'CNY',
    fxRate: 1,
    note: '定投待确认：金额已知，净值 T+1 回填份额',
    source: 'DCA',
    meta: { planId: 'plan-110011', expectedAmount: 1000 },
  }),

  // ===== 加密 · BTC（staking 收入演示） =====
  tx({ id: 'tx-btc-buy1', instrumentId: 'BTC', type: 'BUY', date: '2024-01-10', quantity: 0.5, price: 42000, currency: 'USD', fxRate: 7.18 }),
  tx({ id: 'tx-btc-buy2', instrumentId: 'BTC', type: 'BUY', date: '2024-10-01', quantity: 0.25, price: 61000, currency: 'USD', fxRate: 7.12 }),
  tx({ id: 'tx-btc-income1', instrumentId: 'BTC', type: 'INCOME', date: '2025-02-01', quantity: 0.001, price: 0, amount: 40, currency: 'USD', fxRate: 7.2, note: 'staking 收益（未计税）' }),

  // ===== 黄金 · Au99.99 =====
  tx({ id: 'tx-au-buy1', instrumentId: 'Au99.99', type: 'BUY', date: '2023-10-01', quantity: 200, price: 450, currency: 'CNY', fxRate: 1, note: '实物金条' }),
  tx({ id: 'tx-au-buy2', instrumentId: 'Au99.99', type: 'BUY', date: '2025-03-01', quantity: 100, price: 520, currency: 'CNY', fxRate: 1 }),

  // ===== 美股 TAX_WITHHELD（实际扣税流水，用于 XIRR 现金流） =====
  tx({ id: 'tx-aapl-tax1', instrumentId: 'AAPL', type: 'TAX_WITHHELD', date: '2025-08-15', quantity: 0, price: 0, amount: 15, currency: 'USD', fxRate: 7.25, note: '美股预扣税（W-8BEN 未填 30% 档示例）' }),

  // ===== 已作废流水（演示 VOIDED 状态 + 覆盖 SPLIT/TRANSFER/FUND_SPLIT 类型） =====
  tx({ id: 'tx-voided-demo', instrumentId: '000001.SZ', type: 'BUY', status: 'VOIDED', date: '2025-09-01', quantity: 100, price: 11, currency: 'CNY', fxRate: 1, note: '误操作已作废' }),
  tx({ id: 'tx-voided-split', instrumentId: '00700.HK', type: 'SPLIT', status: 'VOIDED', date: '2026-01-05', quantity: 0, price: 0, currency: 'HKD', fxRate: 0.91, note: '拆股（作废示例）', meta: { ratio: 5 } }),
  tx({ id: 'tx-voided-transfer', instrumentId: '000001.SZ', type: 'TRANSFER', status: 'VOIDED', date: '2026-02-02', quantity: 0, price: 0, currency: 'CNY', fxRate: 1, note: '转增（作废示例）', meta: { ratio: 1.1 } }),
  tx({ id: 'tx-voided-fundsplit', instrumentId: '110011', type: 'FUND_SPLIT', status: 'VOIDED', date: '2026-03-03', quantity: 0, price: 0, currency: 'CNY', fxRate: 1, note: '基金拆分（作废示例）', meta: { ratio: 2 } }),
];

export function seedLastUpdated(): string {
  return `${SEED_TODAY}T07:00:00Z`;
}

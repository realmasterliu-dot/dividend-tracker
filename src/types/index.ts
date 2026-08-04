/**
 * 全部 TS 接口 —— 唯一类型来源（architecture.md §3.1）
 * 禁止在组件中散落类型定义；Engine 纯函数禁止 import React。
 */

// ============ 枚举 ============
export type Market = 'A_SHARE' | 'HK' | 'US' | 'FUND' | 'CRYPTO' | 'GOLD';
export type Currency = 'CNY' | 'USD' | 'HKD';
export type SecurityType = 'COMMON' | 'REIT' | 'MLP_PTP' | 'ADR' | 'ETF' | 'FUND' | 'CRYPTO' | 'GOLD';
export type DividendOption = 'CASH' | 'REINVEST';
export type CustodyChannel =
  | 'CN_BROKER'
  | 'HK_LOCAL_BROKER'
  | 'HK_STOCK_CONNECT'
  | 'US_BROKER'
  | 'CEX'
  | 'SGE'
  | 'PHYSICAL';
export type GoldForm = 'PHYSICAL' | 'ACCUMULATION' | 'ETF' | 'TD' | 'XAU';
export type TransactionType =
  | 'BUY'
  | 'SELL'
  | 'DIVIDEND_CASH'
  | 'DIVIDEND_REINVEST'
  | 'SPLIT'
  | 'BONUS'
  | 'TRANSFER'
  | 'FUND_SPLIT'
  | 'FEE'
  | 'INCOME'
  | 'TAX_WITHHELD';
export type TransactionStatus = 'CONFIRMED' | 'PENDING' | 'VOIDED';
export type DividendStatus =
  | 'PROPOSED'
  | 'APPROVED'
  | 'DECLARED'
  | 'EX_DIVIDEND'
  | 'PAID'
  | 'RECONCILED';
export type PlanFrequency = 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type PlanStatus = 'ACTIVE' | 'PAUSED' | 'ENDED';
export type ColorScheme = 'CN' | 'INTL' | 'COLORBLIND';
export type TaxBracket = 'LE1M' | 'M1_1Y' | 'GT1Y' | 'NONE';
export type DividendForm = 'CASH' | 'SCRIP' | 'CASH_SCRIP';
export type NotificationType =
  | 'DIVIDEND_PROPOSED'
  | 'DIVIDEND_DECLARED'
  | 'RECORD_DATE_CLOSE'
  | 'EX_DATE'
  | 'PAY_DATE'
  | 'DCA_PENDING'
  | 'SOURCE_ERROR'
  | 'CORP_ACTION'
  | 'TAX_BRACKET'
  | 'DATA_STALE';
export type Severity = 'INFO' | 'WARN' | 'ERROR';
export type PredictionFrequency = 'YEARLY' | 'SEMI' | 'QUARTERLY' | 'MONTHLY' | 'IRREGULAR';
export type Confidence = 'HIGH' | 'MED' | 'LOW';
export type PredictionMethod = 'CAGR' | 'MEDIAN' | 'NONE';

// ============ 标的 ============
export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  market: Market;
  currency: Currency;
  dividendEligible: boolean;
  securityType: SecurityType;
  extraWithholdingRate: number;
  dividendOption?: DividendOption;
  custodyChannel: CustodyChannel;
  goldForm?: GoldForm;
  spreadRate?: number;
  dataSourceOverride?: string;
  closed?: boolean;
  tags?: string[];
}

// ============ 交易流水 ============
export interface Transaction {
  id: string;
  instrumentId: string;
  type: TransactionType;
  status: TransactionStatus;
  date: string; // ISO 'yyyy-mm-dd'
  quantity: number;
  price: number;
  amount: number; // 总额（标的币种）
  fee?: number;
  currency: Currency;
  fxRate: number; // 交易日 → 本位币汇率
  note?: string;
  source?: 'MANUAL' | 'DCA' | 'IMPORT' | 'SYSTEM';
  meta?: Record<string, unknown>;
}

// ============ 持仓批次（推导产物，不持久化） ============
export interface TaxLotEvent {
  txId: string;
  date: string;
  quantity: number; // SELL 消耗为负；公司行动为增量
  type: 'SELL' | 'SPLIT' | 'BONUS' | 'TRANSFER' | 'FUND_SPLIT' | 'REINVEST';
}

export interface TaxLot {
  id: string;
  instrumentId: string;
  buyDate: string;
  originalBuyDate: string; // 送转股沿用原股买入日（影响税档）
  quantity: number;
  originalQuantity: number;
  costPerShare: number; // 本位币成本价
  costPerShareLocal: number; // 标的币种成本价
  sourceTxId: string;
  events: TaxLotEvent[];
}

// ============ 持仓（推导产物） ============
export interface Position {
  instrumentId: string;
  instrument: Instrument;
  lots: TaxLot[];
  totalQuantity: number;
  avgCostPerShare: number; // 本位币
  avgCostPerShareLocal: number; // 标的币种
  marketPrice: number; // 标的币种现价
  prevPrice: number; // 前一日收盘（涨跌计算）
  fxRate: number; // 当前汇率 → 本位币
  marketValue: number; // 本位币市值
  costValue: number; // 本位币成本（历史汇率口径）
  costValueCurrentFx: number; // 本位币成本（当前汇率口径，fxNeutral 用）
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  weightPct: number;
  ttmDividend: number; // 近 12 个月分红（金色）
  dividendYield: number;
  incomeYield: number;
  yoc: number;
  annualDividend: number; // 年化分红（预测中点）
  staleDays: number;
  navDate?: string;
}

// ============ 分红事件 ============
export interface DividendEvent {
  id: string;
  instrumentId: string;
  status: DividendStatus;
  announceDate?: string;
  recordDate?: string;
  exDate?: string;
  payDate?: string;
  payDateEstimated: boolean;
  perShareAmount: number; // 每股金额（标的币种）
  currency: Currency;
  quantityAtRecord: number;
  grossAmount: number; // 税前总额（本位币，金色，推导）
  taxRateApplied: number; // 0-1（推导）
  taxWithheld: number; // 已实际扣税（灰，推导 + 手动覆盖）
  contingentTax: number; // 或有税负（橙，A股动态，推导）
  netAmount: number; // 预计最终到手（推导）
  actualReceived?: number; // 用户回填（校准闭环）
  deviationPct?: number; // 回填后估算偏差率
  taxBracket: TaxBracket; // 推导
  daysToZeroTax?: number; // ★再持有 N 天或有税负归零（推导）
  dividendForm: DividendForm;
  isSpecial?: boolean;
  isEstimate?: boolean;
  manual: boolean;
  sourceKey: string;
  taxWithheldOverride?: number; // 手动覆盖实际扣税（持久化）
}

// ============ 定投计划 ============
export interface InvestmentPlan {
  id: string;
  instrumentId: string;
  amount: number;
  frequency: PlanFrequency;
  executionDay: number; // 周几(0-6) 或 几号(1-31)
  startDate: string;
  endDate?: string;
  holidayPolicy: 'NEXT_TRADING_DAY' | 'PREV_TRADING_DAY';
  monthEndPolicy: 'LAST_TRADING_DAY';
  autoConfirm: boolean;
  status: PlanStatus;
  nextRunDate?: string;
}

// ============ 设置 ============
export interface AppSettings {
  baseCurrency: 'CNY' | 'USD';
  displayCurrency: Currency;
  colorScheme: ColorScheme;
  w8benFilled: boolean;
  fxNeutralMode: boolean;
  annualIncomeTarget?: number;
  notificationChannels: { telegram?: string; feishu?: string; wecom?: string };
  quietHours?: { start: string; end: string };
  stalenessThresholdHours: number;
}

// ============ 通知 ============
export interface Notification {
  id: string;
  key: string; // 去重：instrumentId+type+date
  type: NotificationType;
  title: string;
  body: string;
  severity: Severity;
  createdAt: string;
  read: boolean;
  relatedInstrumentId?: string;
}

// ============ 价格/汇率快照 ============
export interface PriceSnapshot {
  instrumentId: string;
  date: string;
  price: number;
  currency: Currency;
  fxRate: number;
  source: string;
  navDate?: string;
}
export interface FxSnapshot {
  date: string;
  rates: Record<string, number>; // {'USDCNY': 7.25}
}

// ============ 组合快照（近似重建） ============
export interface PortfolioSnapshot {
  date: string;
  marketValue: number;
  invested: number;
  dividends: number;
  isEstimated: boolean;
  dataCompleteness: number;
}

// ============ 推导结果 ============
export interface ReturnBreakdown {
  total: number;
  totalPct: number;
  price: number;
  pricePct: number;
  dividend: number;
  dividendPct: number;
  fx: number;
  fxPct: number;
}

export interface DividendPrediction {
  instrumentId: string;
  frequency: PredictionFrequency;
  lower: number;
  upper: number;
  confidence: Confidence;
  stabilityScore: 1 | 2 | 3 | 4 | 5;
  sampleYears: number;
  method: PredictionMethod;
  specialDividendsExcluded: string[];
  note: string;
}

export interface PortfolioMetrics {
  xirr: number;
  twr: number;
  yoc: number;
  overallYield: number;
  incomeYield: number;
}

export interface TodoItem {
  id: string;
  kind: 'PENDING_TX' | 'DATA_STALE' | 'PAY_BACKFILL' | 'CORP_ACTION' | 'TAX_BRACKET';
  title: string;
  detail: string;
  severity: Severity;
}

// ============ Store State ============
export interface DataState {
  instruments: Instrument[];
  transactions: Transaction[];
  dividends: DividendEvent[];
  plans: InvestmentPlan[];
  notifications: Notification[];
  prices: PriceSnapshot[];
  fx: FxSnapshot[];
  lastUpdated: string;
  sourceHealth: Record<
    string,
    { lastSuccess: string; consecutiveFailures: number; status: 'GREEN' | 'YELLOW' | 'RED' }
  >;
}

// ============ 引擎辅助类型 ============
export interface TaxResult {
  bracket: TaxBracket;
  rate: number;
  taxWithheld: number;
  contingentTax: number;
  daysToZeroTax: number;
  note: string;
}

export interface Cashflow {
  date: string;
  amount: number; // 本位币；流入为正，流出为负
}

export interface CalendarEventItem {
  dividend: DividendEvent;
  marker: 'RECORD' | 'EX' | 'PAY';
  date: string;
  amount: number;
}

export interface CalendarDayCell {
  date: string;
  items: CalendarEventItem[];
}

export interface PendingItem {
  dividend: DividendEvent;
  stage: 'PROPOSED' | 'APPROVED';
}

export interface HeatCell {
  date: string;
  amount: number;
  count: number;
}

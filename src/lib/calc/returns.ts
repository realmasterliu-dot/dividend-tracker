import {
  AppSettings,
  Cashflow,
  DividendEvent,
  Position,
  PortfolioSnapshot,
  ReturnBreakdown,
  Transaction,
} from '@/types';
import { daysBetween, todayISO } from '../clock';
import { accountingDividendEvents } from '../transactionDividend';

/**
 * ReturnEngine（architecture.md 类图）
 * XIRR（牛顿迭代，与 Excel XIRR 一致误差 <0.01%）、TWR（日链式）、YOC、三段回报拆解。
 */

/** XIRR：牛顿迭代法求解内部收益率 */
export function xirr(cashflows: Cashflow[], guess = 0.1): number {
  const flows = cashflows.filter((cf) => Math.abs(cf.amount) > 1e-9).sort((a, b) => a.date.localeCompare(b.date));
  if (flows.length < 2) return 0;
  const t0 = flows[0].date;
  const times = flows.map((cf) => daysBetween(t0, cf.date) / 365);
  const amounts = flows.map((cf) => cf.amount);

  let rate = guess;
  const maxIter = 200;
  const tol = 1e-9;

  for (let iter = 0; iter < maxIter; iter++) {
    let f = 0;
    let df = 0;
    for (let i = 0; i < flows.length; i++) {
      const denom = Math.pow(1 + rate, times[i]);
      f += amounts[i] / denom;
      df += (-times[i] * amounts[i]) / Math.pow(1 + rate, times[i] + 1);
    }
    if (Math.abs(f) < tol) break;
    if (Math.abs(df) < 1e-12) break;
    const next = rate - f / df;
    if (Math.abs(next - rate) < 1e-10) {
      rate = next;
      break;
    }
    rate = next;
  }

  if (!Number.isFinite(rate)) return 0;
  return rate;
}

function linkedDividendEventId(transaction: Transaction): string | undefined {
  const value = transaction.meta?.dividendEventId;
  return typeof value === 'string' && value ? value : undefined;
}

function dividendEventDate(event: DividendEvent): string | undefined {
  return event.payDate ?? event.exDate ?? event.recordDate;
}

/**
 * 已实现的收益现金流（本位币）。
 *
 * 分红事件是金额事实的唯一权威来源：管道 PAID 事件和用户
 * RECONCILED 事件都会进入收益。现金分红交易只用来补足尚未关联事件的
 * 旧数据，避免一笔到账同时被 transaction 和 DividendEvent 计两次。
 *
 * 红利再投是组合内部再投资：既不是外部入金，也不是离开组合的
 * 现金流。它的回报已体现在新增份额的市值中，因此这里不再记一笔收入。
 */
export function realizedIncomeCashflows(
  transactions: Transaction[],
  dividends: DividendEvent[],
): Cashflow[] {
  const confirmed = transactions.filter((transaction) => transaction.status === 'CONFIRMED');
  const reinvestedEventIds = new Set(
    confirmed
      .filter((transaction) => transaction.type === 'DIVIDEND_REINVEST')
      .map(linkedDividendEventId)
      .filter((id): id is string => id !== undefined),
  );

  const flows: Cashflow[] = [];
  const accountedCashEventIds = new Set<string>();

  for (const event of accountingDividendEvents(dividends)) {
    if (event.status !== 'PAID' && event.status !== 'RECONCILED') continue;
    if (event.dividendForm === 'SCRIP' || reinvestedEventIds.has(event.id)) continue;

    const date = dividendEventDate(event);
    if (!date) continue;

    // netAmount 是税后本位币口径；校准事件再优先采用实际到账。
    const amount =
      typeof event.actualReceived === 'number' && Number.isFinite(event.actualReceived)
        ? event.actualReceived
        : event.netAmount;
    if (Number.isFinite(amount) && Math.abs(amount) > 1e-9) {
      flows.push({ date, amount });
    }
    // 即使金额为 0，事件仍然是这笔到账的权威事实，
    // 不应回退到关联交易金额。
    accountedCashEventIds.add(event.id);
  }

  for (const transaction of confirmed) {
    const amount = transaction.amount * transaction.fxRate;
    switch (transaction.type) {
      case 'DIVIDEND_CASH': {
        const eventId = linkedDividendEventId(transaction);
        if (!eventId || !accountedCashEventIds.has(eventId)) {
          flows.push({ date: transaction.date, amount });
        }
        break;
      }
      case 'INCOME':
        flows.push({ date: transaction.date, amount });
        break;
      case 'TAX_WITHHELD':
        flows.push({ date: transaction.date, amount: -amount });
        break;
      default:
        break;
    }
  }

  return flows.sort((a, b) => a.date.localeCompare(b.date));
}

/** 外部资金 + 已实现收益 → XIRR 现金流（含今日市值作为最终流入） */
export function xirrCashflows(
  transactions: Transaction[],
  dividends: DividendEvent[],
  marketValue: number,
  today: string,
): Cashflow[] {
  const flows: Cashflow[] = [];
  for (const tx of transactions) {
    if (tx.status !== 'CONFIRMED') continue;
    const fx = tx.fxRate;
    switch (tx.type) {
      case 'BUY':
        flows.push({ date: tx.date, amount: -(tx.amount + (tx.fee ?? 0)) * fx });
        break;
      case 'SELL':
        flows.push({ date: tx.date, amount: (tx.amount - (tx.fee ?? 0)) * fx });
        break;
      case 'FEE':
        flows.push({ date: tx.date, amount: -tx.amount * fx });
        break;
      default:
        break;
    }
  }
  flows.push(...realizedIncomeCashflows(transactions, dividends));
  flows.push({ date: today, amount: marketValue });
  return flows.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * TWR：日链式。invested 的变化是外部资金流，现金分红等已实现
 * 收益需加回期末市值，否则除息后的价格下降会被误认为亏损。
 */
export function twr(
  snapshots: PortfolioSnapshot[],
  realizedIncome: Cashflow[] = [],
): number {
  let product = 1;
  let prev: PortfolioSnapshot | undefined;
  const income = [...realizedIncome].sort((a, b) => a.date.localeCompare(b.date));
  let incomeIdx = 0;
  for (const snap of snapshots) {
    if (prev) {
      // 跳过首个快照之前（含当日）的收益；它已经包含在期初价值中。
      while (incomeIdx < income.length && income[incomeIdx].date <= prev.date) incomeIdx++;
      let periodIncome = 0;
      while (incomeIdx < income.length && income[incomeIdx].date <= snap.date) {
        periodIncome += income[incomeIdx].amount;
        incomeIdx++;
      }
      const flow = snap.invested - prev.invested;
      const base = prev.marketValue;
      if (base > 1e-9) {
        const dailyReturn = (snap.marketValue + periodIncome - flow - base) / base;
        product *= 1 + dailyReturn;
      }
    }
    prev = snap;
  }
  return product - 1;
}

export function yoc(ttmDividend: number, costValue: number): number {
  if (costValue <= 0) return 0;
  return ttmDividend / costValue;
}

/** 三段回报拆解：总回报 = 价格回报 + 分红回报 + 汇兑回报（PRD §7.4） */
export function breakdown(
  positions: Position[],
  transactions: Transaction[],
  dividends: DividendEvent[],
  settings: AppSettings,
): ReturnBreakdown {
  let price = 0;
  let fx = 0;
  let costHistorical = 0;
  let dividend = 0;

  for (const pos of positions) {
    // 价格回报（当前汇率口径，标的本身涨跌）
    price += (pos.marketValue - pos.costValueCurrentFx);
    // 汇兑回报：成本按历史汇率 vs 当前汇率之差
    fx += pos.costValueCurrentFx - pos.costValue;
    costHistorical += pos.costValue;
  }

  if (settings.fxNeutralMode) fx = 0;

  // 分红回报：已到账分红净额（本位币）
  for (const d of accountingDividendEvents(dividends)) {
    if (d.status === 'PAID' || d.status === 'RECONCILED') {
      dividend += d.actualReceived ?? d.netAmount;
    }
  }

  const total = price + fx + dividend;
  const base = Math.abs(costHistorical) > 1e-9 ? costHistorical : 1;
  return {
    total,
    totalPct: total / base,
    price,
    pricePct: price / base,
    dividend,
    dividendPct: dividend / base,
    fx,
    fxPct: fx / base,
  };
}

export function yocOfPositions(positions: Position[]): number {
  const ttm = positions.reduce((s, p) => s + p.ttmDividend, 0);
  const cost = positions.reduce((s, p) => s + p.costValue, 0);
  return cost > 0 ? ttm / cost : 0;
}

export function todayForXirr(): string {
  return todayISO();
}

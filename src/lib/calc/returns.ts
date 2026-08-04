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

/** 交易流水 → XIRR 现金流（本位币口径；含今日市值作为最终流入） */
export function xirrCashflows(
  transactions: Transaction[],
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
      case 'DIVIDEND_CASH':
        flows.push({ date: tx.date, amount: tx.amount * fx });
        break;
      case 'DIVIDEND_REINVEST':
        break;
      case 'FEE':
        flows.push({ date: tx.date, amount: -tx.amount * fx });
        break;
      case 'INCOME':
        flows.push({ date: tx.date, amount: tx.amount * fx });
        break;
      case 'TAX_WITHHELD':
        flows.push({ date: tx.date, amount: -tx.amount * fx });
        break;
      default:
        break;
    }
  }
  flows.push({ date: today, amount: marketValue });
  return flows;
}

/** TWR：日链式，仅外部资金流（累计投入变化）作为 flow */
export function twr(snapshots: PortfolioSnapshot[]): number {
  let product = 1;
  let prev: PortfolioSnapshot | undefined;
  for (const snap of snapshots) {
    if (prev) {
      const flow = snap.invested - prev.invested;
      const base = prev.marketValue;
      if (base > 1e-9) {
        const dailyReturn = (snap.marketValue - flow - base) / base;
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
  for (const d of dividends) {
    if (d.status === 'PAID' || d.status === 'RECONCILED') {
      dividend += d.netAmount;
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

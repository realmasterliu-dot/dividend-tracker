import { FxSnapshot, PriceSnapshot } from '@/types';
import { addDays, SEED_TODAY } from '@/lib/clock';

/**
 * 种子价格/汇率快照 —— 确定性伪随机生成（mulberry32），保证每次加载一致。
 * - 日线从 2023-01-01 到 SEED_TODAY
 * - 00700.HK 故意止于 3 天前（演示"陈旧角标 ⚠ 3天前"）
 * - 基金 110011 带 navDate（净值 T+1 标注）
 */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const PRICE_START = '2023-01-01';

interface SeriesSpec {
  instrumentId: string;
  startPrice: number;
  annualDrift: number;
  annualVol: number;
  seed: number;
  endDate?: string;
  navLag?: boolean;
  currency: PriceSnapshot['currency'];
  source: string;
}

const series: SeriesSpec[] = [
  { instrumentId: '600519.SH', startPrice: 1700, annualDrift: -0.02, annualVol: 0.22, seed: 11, currency: 'CNY', source: 'akshare·A股' },
  { instrumentId: '000001.SZ', startPrice: 10.5, annualDrift: 0.03, annualVol: 0.18, seed: 22, currency: 'CNY', source: 'akshare·A股' },
  { instrumentId: '00700.HK', startPrice: 310, annualDrift: 0.06, annualVol: 0.28, seed: 33, endDate: '2026-08-01', currency: 'HKD', source: 'yfinance·港股' },
  { instrumentId: 'AAPL', startPrice: 185, annualDrift: 0.08, annualVol: 0.22, seed: 44, currency: 'USD', source: 'yfinance·美股' },
  { instrumentId: '110011', startPrice: 3.2, annualDrift: 0.04, annualVol: 0.12, seed: 55, navLag: true, currency: 'CNY', source: '天天基金' },
  { instrumentId: 'BTC', startPrice: 42000, annualDrift: 0.25, annualVol: 0.6, seed: 66, currency: 'USD', source: 'CoinGecko' },
  { instrumentId: 'Au99.99', startPrice: 450, annualDrift: 0.07, annualVol: 0.12, seed: 77, currency: 'CNY', source: '上金所' },
];

function buildPrices(): PriceSnapshot[] {
  const out: PriceSnapshot[] = [];
  for (const spec of series) {
    const rand = mulberry32(spec.seed);
    const end = spec.endDate ?? SEED_TODAY;
    let price = spec.startPrice;
    const driftPerDay = spec.annualDrift / 252;
    const volPerDay = spec.annualVol / Math.sqrt(252);
    let date = PRICE_START;
    let guard = 0;
    while (date <= end && guard < 4000) {
      const shock = gauss(rand);
      price = Math.max(price * (1 + driftPerDay + volPerDay * shock), spec.startPrice * 0.2);
      out.push({
        instrumentId: spec.instrumentId,
        date,
        price: round(price, spec.instrumentId === 'BTC' ? 2 : 2),
        currency: spec.currency,
        fxRate: 1,
        source: spec.source,
        navDate: spec.navLag ? addDays(date, -1) : undefined,
      });
      date = addDays(date, 1);
      guard++;
    }
  }
  return out;
}

function round(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function buildFx(): FxSnapshot[] {
  const out: FxSnapshot[] = [];
  const rand = mulberry32(2026);
  let usdcny = 7.12;
  let hkdcny = 0.905;
  let date = PRICE_START;
  let guard = 0;
  while (date <= SEED_TODAY && guard < 4000) {
    usdcny = Math.max(7.0, Math.min(7.5, usdcny * (1 + 0.0001 + 0.004 * gauss(rand))));
    hkdcny = Math.max(0.88, Math.min(0.94, hkdcny * (1 + 0.00005 + 0.002 * gauss(rand))));
    out.push({
      date,
      rates: {
        USDCNY: round(usdcny, 4),
        HKDCNY: round(hkdcny, 4),
        CNYUSD: round(1 / usdcny, 4),
        CNYHKD: round(1 / hkdcny, 4),
      },
    });
    date = addDays(date, 1);
    guard++;
  }
  return out;
}

export const seedPrices: PriceSnapshot[] = buildPrices();
export const seedFx: FxSnapshot[] = buildFx();

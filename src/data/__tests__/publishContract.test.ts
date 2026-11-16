import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Static market-data publication contract.
 *
 * CloudBase response caching is configured and verified on the deployed environment,
 * not through Cloudflare-specific files in public/. This test protects the part that
 * genuinely belongs in the repository: the bounded data artifacts emitted by the pipeline.
 */

const repoFile = (relative: string): string =>
  fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

const readText = (relative: string): string => readFileSync(repoFile(relative), 'utf-8');
const readJson = <T>(relative: string): T => JSON.parse(readText(relative)) as T;

function parseDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / 86_400_000);
}

interface RawPrice {
  instrumentId: string;
  date: string;
}

describe('public/data/prices.json · bounded publication contract', () => {
  const prices = readJson<RawPrice[]>('public/data/prices.json');
  const dates = prices.map((price) => price.date);
  const minDate = dates.reduce((left, right) => (left < right ? left : right));
  const maxDate = dates.reduce((left, right) => (left > right ? left : right));
  const configuredMaxDays = (() => {
    const source = readText('scripts/pipeline/config.py');
    const match = source.match(
      /MAX_PRICE_HISTORY_DAYS[^=]*=\s*int\(\s*os\.environ\.get\(\s*"PIPELINE_MAX_PRICE_DAYS"\s*,\s*"(\d+)"\s*\)/,
    );
    return match ? Number(match[1]) : null;
  })();

  it('keeps the configured default history at 540 days', () => {
    expect(configuredMaxDays).toBe(540);
  });

  it('trims only prices before writing publication artifacts', () => {
    const source = readText('scripts/pipeline/fetch_all.py');
    expect(source).toContain('MAX_PRICE_HISTORY_DAYS');
    expect(source).toMatch(/def trim_price_history\(/);
    expect(source).toMatch(/trim_price_history\(prices\)/);
    expect(source).toMatch(/"prices\.json",\s*\[s\.to_dict\(\) for s in published_prices\]/);
    expect(source).toMatch(/"dividends\.json",\s*\[e\.to_dict\(\) for e in dividends\]/);
    expect(source).toMatch(/"fx\.json",\s*\[s\.to_dict\(\) for s in fx_snapshots\]/);
  });

  it(`publishes no more than the configured window (${minDate} → ${maxDate})`, () => {
    expect(daysBetween(minDate, maxDate)).toBeLessThanOrEqual(configuredMaxDays!);
  });

  it('keeps prices below 500KB and enough history for useful charts', () => {
    expect(statSync(repoFile('public/data/prices.json')).size).toBeLessThan(500 * 1024);
    expect(prices.length).toBeGreaterThan(1200);
    const perInstrument = new Map<string, number>();
    prices.forEach((price) => {
      perInstrument.set(price.instrumentId, (perInstrument.get(price.instrumentId) ?? 0) + 1);
    });
    expect([...perInstrument.values()].filter((count) => count > 250).length).toBeGreaterThanOrEqual(6);
  });

  it('keeps valid ISO dates inside the window', () => {
    expect(prices.every((price) => price.date >= minDate && price.date <= maxDate)).toBe(true);
    expect(prices.every((price) => /^\d{4}-\d{2}-\d{2}$/.test(price.date))).toBe(true);
  });

  it('retains longer FX and dividend histories', () => {
    const fx = readJson<{ date: string }[]>('public/data/fx.json');
    const dividends = readJson<{ exDate?: string }[]>('public/data/dividends.json');
    const fxMin = fx.map((item) => item.date).reduce((left, right) => (left < right ? left : right));
    expect(fxMin < minDate).toBe(true);
    expect(fx.length).toBeGreaterThan(900);
    const exDates = dividends.map((item) => item.exDate).filter((date): date is string => Boolean(date));
    expect(exDates.reduce((left, right) => (left < right ? left : right)) < minDate).toBe(true);
  });
});

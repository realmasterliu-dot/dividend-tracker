import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 发布契约门禁（QA · f69b747「缓存 + 历史裁剪」专项）
 *
 * 背景：本次性能优化有两半，而原有测试只守住了其中一半 ——
 *
 * 1. 【A1 缓存】前端已有用例断言 fetch 默认发 `cache:'default'`、手动刷新发 `'no-cache'`，
 *    但那只是「客户端请求语义」。真正让首屏省掉 ~1MB 的是服务端 `public/_headers` 里
 *    `/data/*` 的 `max-age=3600`。若有人把它改回 `no-cache`，浏览器每次都回源，
 *    优化 100% 静默失效，而全套 314 个用例依然全绿 —— 属于「测了个寂寞」。
 *
 * 2. 【A2 裁剪】裁剪逻辑在 Python 管道里（scripts/pipeline），仓库内没有任何 Python
 *    测试框架，等于零覆盖。产物 `public/data/prices.json` 是提交进仓库的静态数据层，
 *    一旦管道回归（写回全量历史），首屏体积会从 370KB 弹回 898KB，同样无人报警。
 *
 * 本文件把这两条「跨语言 / 跨配置」的契约钉死在 npm test 里：
 * 配置文件与数据产物本身就是这个 Git-as-DB 架构的一等公民，必须像代码一样被门禁。
 */

const repoFile = (relative: string): string =>
  fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

const readText = (relative: string): string => readFileSync(repoFile(relative), 'utf-8');

const readJson = <T>(relative: string): T => JSON.parse(readText(relative)) as T;

/**
 * 解析 Cloudflare Pages 的 `_headers` 文件。
 *
 * 格式：顶格的 `/path` 开启一个块，其下缩进行是 `Header: value`，`#` 开头为注释。
 *
 * @param text `_headers` 全文。
 * @returns 路径模式 → { 响应头名(小写): 值 }。
 */
function parseHeaders(text: string): Map<string, Record<string, string>> {
  const blocks = new Map<string, Record<string, string>>();
  let current: string | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;

    if (!/^\s/.test(line)) {
      current = line.trim();
      if (!blocks.has(current)) blocks.set(current, {});
      continue;
    }
    if (!current) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    blocks.get(current)![name] = line.slice(separator + 1).trim();
  }
  return blocks;
}

/** 'YYYY-MM-DD' → UTC 毫秒（纯字符串解析，不受运行时时区影响） */
function parseDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** 两个 'YYYY-MM-DD' 之间相差的天数 */
function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / 86_400_000);
}

// ============================================================
// A1 · public/_headers 缓存契约
// ============================================================

describe('public/_headers · 数据层缓存契约（A1 的服务端一半）', () => {
  const headers = parseHeaders(readText('public/_headers'));
  const dataRule = headers.get('/data/*');

  it('存在 /data/* 规则块', () => {
    expect(dataRule).toBeDefined();
    expect(dataRule!['cache-control']).toBeTypeOf('string');
  });

  it('/data/* 必须是 public + max-age=3600 + stale-while-revalidate=86400', () => {
    const value = dataRule!['cache-control'];
    expect(value).toContain('public');
    expect(value).toMatch(/max-age=3600\b/);
    expect(value).toMatch(/stale-while-revalidate=86400\b/);
  });

  it('★/data/* 绝不能退回 no-cache/no-store —— 否则前端 cache:\'default\' 形同虚设', () => {
    const value = dataRule!['cache-control'];
    expect(value).not.toMatch(/\bno-cache\b/);
    expect(value).not.toMatch(/\bno-store\b/);
    expect(value).not.toMatch(/\bmax-age=0\b/);
  });

  it('应用外壳 /index.html 仍必须 no-cache（新部署立刻生效，不被 SPA 旧壳挡住）', () => {
    expect(headers.get('/index.html')?.['cache-control']).toContain('no-cache');
  });

  it('带 hash 的 /assets/* 仍是 immutable 长缓存（本次改动不得误伤）', () => {
    const value = headers.get('/assets/*')?.['cache-control'] ?? '';
    expect(value).toContain('immutable');
    expect(value).toMatch(/max-age=31536000\b/);
  });

  it('全局安全响应头未被本次缓存改动挤掉（安全回归护栏）', () => {
    const global = headers.get('/*') ?? {};
    expect(global['x-content-type-options']).toBe('nosniff');
    expect(global['x-frame-options']).toBe('DENY');
    expect(global['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});

// ============================================================
// A2 · prices.json 历史裁剪契约
// ============================================================

interface RawPrice {
  instrumentId: string;
  date: string;
}

describe('public/data/prices.json · 历史裁剪契约（A2 的产物一半）', () => {
  const prices = readJson<RawPrice[]>('public/data/prices.json');
  const dates = prices.map((p) => p.date);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  /** 从 config.py 抽出 MAX_PRICE_HISTORY_DAYS 默认值，避免 Python 与前端护栏各改各的 */
  const configuredMaxDays = (() => {
    const source = readText('scripts/pipeline/config.py');
    const match = source.match(
      /MAX_PRICE_HISTORY_DAYS[^=]*=\s*int\(\s*os\.environ\.get\(\s*"PIPELINE_MAX_PRICE_DAYS"\s*,\s*"(\d+)"\s*\)/,
    );
    return match ? Number(match[1]) : null;
  })();

  it('config.py 已定义 MAX_PRICE_HISTORY_DAYS 且默认 540 天', () => {
    expect(configuredMaxDays).toBe(540);
  });

  it('fetch_all.py 确实在写 prices.json 前调用了裁剪（仅 prices，不碰 dividends/fx）', () => {
    const source = readText('scripts/pipeline/fetch_all.py');
    expect(source).toContain('MAX_PRICE_HISTORY_DAYS');
    expect(source).toMatch(/def trim_price_history\(/);
    // 写出的是裁剪后的列表，而不是原始 prices
    expect(source).toMatch(/trim_price_history\(prices\)/);
    expect(source).toMatch(/"prices\.json",\s*\[s\.to_dict\(\) for s in published_prices\]/);
    // dividends / fx 必须写原始全量
    expect(source).toMatch(/"dividends\.json",\s*\[e\.to_dict\(\) for e in dividends\]/);
    expect(source).toMatch(/"fx\.json",\s*\[s\.to_dict\(\) for s in fx_snapshots\]/);
  });

  it(`发布窗口不超过 MAX_PRICE_HISTORY_DAYS（实测 ${minDate} → ${maxDate}）`, () => {
    expect(daysBetween(minDate, maxDate)).toBeLessThanOrEqual(configuredMaxDays!);
  });

  it('首屏体积预算：prices.json < 500KB（裁剪前为 898KB）', () => {
    const bytes = statSync(repoFile('public/data/prices.json')).size;
    expect(bytes).toBeLessThan(500 * 1024);
  });

  it('裁剪不得裁过头：仍保留足够画图的序列（>1200 条、≥6 个标的有完整一年以上）', () => {
    expect(prices.length).toBeGreaterThan(1200);

    const perInstrument = new Map<string, number>();
    for (const p of prices) perInstrument.set(p.instrumentId, (perInstrument.get(p.instrumentId) ?? 0) + 1);
    const wellCovered = [...perInstrument.values()].filter((n) => n > 250);
    expect(wellCovered.length).toBeGreaterThanOrEqual(6);
  });

  it('每条记录的日期都不早于窗口下界（证明过滤是逐条生效，而非只截了个头）', () => {
    const cutoff = dates.reduce((a, b) => (a < b ? a : b));
    expect(prices.every((p) => p.date >= cutoff)).toBe(true);
    expect(prices.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date))).toBe(true);
  });

  it('★只裁 prices：fx.json 与 dividends.json 仍保留长历史', () => {
    const fx = readJson<{ date: string }[]>('public/data/fx.json');
    const dividends = readJson<{ exDate?: string }[]>('public/data/dividends.json');

    const fxMin = fx.map((f) => f.date).reduce((a, b) => (a < b ? a : b));
    // 汇率历史必须比行情窗口更长 —— 否则说明裁剪逻辑误伤了其它契约文件
    expect(fxMin < minDate).toBe(true);
    expect(fx.length).toBeGreaterThan(900);

    const exDates = dividends.map((d) => d.exDate).filter((d): d is string => Boolean(d));
    expect(exDates.reduce((a, b) => (a < b ? a : b)) < minDate).toBe(true);
  });
});

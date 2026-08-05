# 数据管道

分红追踪系统的数据管道。抓取 7 个种子标的的**行情 / 分红 / 汇率**，输出前端契约 JSON 到 `public/data/`。

纯 Python，无数据库，无服务端。全部状态落在仓库里的 JSON 文件中。

---

## 快速开始

```bash
cd scripts/pipeline
pip install -r requirements.txt

python fetch_all.py --probe      # 先探连通性，不写任何文件
python fetch_all.py --verbose    # 完整抓取
```

首次运行约 **35–80s**（取决于境外源是否超时），生成 5 个 JSON 文件。

---

## 输出文件

全部写入 `public/data/`，字段严格对齐 `src/types/index.ts`。

| 文件 | 内容 | 说明 |
|---|---|---|
| `prices.json` | `PriceSnapshot[]` | 日行情，含 `fxRate` 快照 |
| `dividends.json` | `DividendEvent[]` | 分红事件 |
| `fx.json` | `FxSnapshot[]` | 汇率，key 形如 `USDCNY` |
| `source_health.json` | `Record<string, SourceHealth>` | 各源健康度，给前端做降级提示 |
| `meta.json` | 运行元信息 | 版本 / 时间戳 / 条数 / 警告 |

### 关于派生字段

管道**只输出客观市场数据**。`DividendEvent` 中依赖用户持仓的派生字段一律写占位值，由前端按用户实际持仓计算：

```
quantityAtRecord = 0      grossAmount = 0
taxRate = 0               taxAmount = 0
netAmount = 0             taxBracket = 'NONE'
```

管道不知道、也不应该知道用户持有多少股。

---

## 命令行

```
python fetch_all.py [选项]
```

| 选项 | 说明 |
|---|---|
| `--only prices,dividends,fx` | 只抓指定类别（默认全部） |
| `--instruments 600519.SH,AAPL` | 只处理指定标的（默认全部 7 个） |
| `--probe` | 连通性探测，逐源测试但不写文件 |
| `--backfill` | 忽略缓存，从 `COLD_START_DATE` 全量回填 |
| `--lookback N` | 增量窗口天数 |
| `--output-dir DIR` | 改输出目录 |
| `--verbose` | DEBUG 级日志 |

常用组合：

```bash
python fetch_all.py --only fx                        # 只更新汇率
python fetch_all.py --instruments BTC --verbose      # 单独调试一个标的
python fetch_all.py --backfill                       # 重建全部历史
```

---

## 数据源矩阵

**以下状态均为沙箱内实测结果**，不是文档抄录。降级链自上而下依次尝试。

### 行情

| 标的 | 降级链 | 实测 |
|---|---|---|
| A股 600519.SH / 000001.SZ | `stock_zh_a_hist` | ✅ 稳定 |
| 港股 00700.HK | `stock_hk_hist` | ✅ 稳定 |
| 美股 AAPL | `stock_us_hist`(105.AAPL) → `stock_us_daily` | ✅ 首选可用 |
| 基金 110011 | `fund_open_fund_info_em` | ✅ 稳定，T+1 |
| 加密 BTC | `binance.klines` → **`gold-api.crypto`** → `coinbase.spot` → `coingecko.simple` → `crypto_js_spot` | ⚠️ 降级到第 2 个 |
| 黄金 Au99.99 | **`fund_etf_hist_em`(518880×100)** → `gold-api.xau` → `spot_hist_sge` | ⚠️ 代理源 |

### 分红

| 标的 | 降级链 | 实测 |
|---|---|---|
| A股 | `stock_fhps_detail_em` → `stock_fhps_em` | ✅ 首选可用 |
| 港股 | **`stock_hk_dividend_payout_em`** → `stock_hk_fhpx_detail_ths` | ✅ 首选可用 |
| 美股 | **Nasdaq 官方 API** | ✅ 可用，可回溯至 1987 |
| 基金 | `fund_fh_em` | ✅ 可用（110011 确实无分红记录） |

### 汇率

`frankfurter.dev`(range) → `frankfurter.dev`(latest) → `open.er-api.com`　✅ 首选可用

ECB 只发布工作日汇率，`FxResolver` 对非交易日做前向填充（BTC 7×24 但汇率只有工作日）。

---

## 已知降级与真实影响

### 1. BTC 只有现价，没有历史K线

`api.binance.com` 在境内网络必然 ReadTimeout，实际落到 `gold-api` 现价源，**每天只能拿到 1 个点**。

- 影响：BTC 无法回填历史曲线，只能从今天起逐日累积。
- 缓解：管道每跑一天就攒一个点，缓存持久化。如果部署到境外 runner，binance 会自动恢复（降级链不需要改代码）。

### 2. 黄金是 ETF 代理价，不是上金所现货价

上金所 `spot_hist_sge` 的 SSL 证书在沙箱内握手失败。改用黄金 ETF 518880 收盘价 ×100 折算成「元/克」。

- 影响：与上金所 Au99.99 官方价存在**基差**（ETF 有折溢价、管理费损耗），不是精确现货价。
- 缓解：`source` 字段明确标注「代理」，前端可提示用户。SSL 恢复后自动切回首选源。

### 3. 港股分红缺少实际派息日

`stock_hk_dividend_payout_em` 的「发放日」字段实测**恒为空**。用除净日 + `HK_PAY_LAG_DAYS`(45天) 估算，并置 `payDateEstimated = true`。

- 影响：港股 `payDate` 是估算值，前端应据此标注。

### 4. `crypto_js_spot` 是陷阱源

它返回 HTTP 200，看起来完全正常，但数据**冻结在 2023-10-02**（BTC $28,309）。

- 处理：放在降级链**最末位**，并让它携带源自身的「更新时间」而非当天日期，由质量闸门的新鲜度规则拦截。
- 这也是为什么闸门必须有 freshness 规则 —— 光看 HTTP 状态码会把两年前的脏数据当成今天的行情写进去。

---

## 设计要点

### ResilientFetcher（`providers/base.py`）

降级链 + 超时 + 指数退避 + 熔断。核心约定：**任何源失败都不抛异常**，只降级，最终返回 `ChainResult`。管道永远不会因为某个源挂了而崩掉。

- **按异常类型收敛重试**：`SSLError` / `ReadTimeout` 这类连接层错误重试也没用，只试 1 次；解析类错误才重试 3 次。
- **熔断**：连续失败 N 次后进入冷却期，直接跳过，避免每次运行都白等超时。
- 熔断状态存 `cache/_circuit_state.json`（与前端契约的 `source_health.json` 分开，两者用途不同）。

### 质量闸门（`quality_gate.py`）

四类规则，判定为 `ACCEPT` / `SUSPECT` / `REJECT`：

1. **合法性** — 价格 ≤0 / None / NaN、日期越界或未来日期 → REJECT
2. **新鲜度** — 仅现价源，超过 `MAX_SPOT_STALENESS_DAYS` → REJECT（专治上面第 4 条）
3. **连续性** — 相对前值偏离 >20%（加密 >50%）→ SUSPECT，**保留旧值不覆盖**
4. **级联保护** — 连续 `SUSPECT_STREAK_TOLERANCE` 个点都存疑，判定为真实跳空而非解析错位，放行

分红事件**允许未来日期**（已宣派未发放是正常且有价值的数据），上限 `MAX_DIVIDEND_FUTURE_DAYS`。

### 增量缓存（`cache/`）

```
cache/
├── prices/{instrumentId}.json
├── dividends/{instrumentId}.json     # 带 schemaVersion
├── fx.json
└── _circuit_state.json
```

**这个目录必须提交进仓库。** 它是增量抓取的基线：CI 每次只拉最近 N 天，历史全部来自缓存。忽略掉的话每次 CI 都会退化成全量回填。

每个标的抓完立刻落盘，中途崩溃不丢已完成的部分。输出文件用「临时文件 + 原子替换」写入，不会留半截 JSON 让前端解析崩溃。

### 分红缓存的 schema 版本

分红缓存按 `sourceKey` 累积、**只增不删** —— 这样源临时降级少返记录时不会丢历史。代价是 `sourceKey` 规则一变，旧键不会被清理，同一笔分红会以新旧两个键并存。

所以：**任何改动 `sourceKey` 构成方式的提交，都必须把 `DIVIDEND_CACHE_SCHEMA` +1。** 管道检测到版本不一致会自动重建缓存，并保留用户手工录入（`manual`）的条目。

> 这不是假设出来的风险。港股 `sourceKey` 原本是 `(代码, 财年, 除净日)`，而腾讯 FY2008 在同一个除净日 2009-05-06 派了两笔（年度 HK$0.25 + 特别 HK$0.10），键相撞导致**静默丢失一条**。修复方式是把「分配类型」并入键，并引入本机制处理老缓存。

### 幂等

同样的输入跑多少次，输出都一样。缓存按 `sourceKey` / 日期合并，不会重复累加。可以放心重试。

---

## 文件结构

```
scripts/pipeline/
├── requirements.txt
├── config.py              # 全部常量：标的、阈值、端点、映射表
├── models.py              # 与 src/types/index.ts 对齐的数据类
├── quality_gate.py        # 质量闸门
├── fetch_all.py           # 编排 + CLI 入口
├── providers/
│   ├── base.py            # ResilientFetcher / HealthRegistry / 工具函数
│   ├── cn_stock.py  hk_stock.py  us_stock.py
│   ├── fund.py      crypto.py    gold.py
│   └── fx.py              # FxProvider + FxResolver（前向填充）
└── cache/                 # 增量缓存（提交进仓库）
```

---

## 排障

**A股/港股拉不到数据** —— 东财对境外 IP 限流。先跑 `--probe` 确认；GitHub Actions 上建议加代理或换 runner 区域。

**BTC 只有 1 条** —— 预期行为，见「已知降级 1」。

**某个源一直被跳过** —— 熔断冷却中。删掉 `cache/_circuit_state.json` 可强制重置。

**想从头重建** —— `python fetch_all.py --backfill`。不要手动删 `cache/`，那会连手工录入的分红一起删掉。

---

## 前端接入

管道只负责产出 `public/data/*.json`。前端切换数据源需改两处（**不在本管道职责内**）：

- `src/store/DataContext.tsx` 的 `buildSeedState()` → 改为 fetch 远端 JSON
- `src/lib/clock.ts` 的 `SEED_TODAY` → 切成真实系统日期

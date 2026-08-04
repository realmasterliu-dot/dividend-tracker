# 数据管道（占位 · 本阶段不实现）

> 本阶段为纯前端交付。以下为未来数据管道（Python + GitHub Actions + Cloudflare Pages Functions）的规划，仅作占位说明，不实现真实爬虫。

## 目标

每日自动拉取六类资产行情 / 分红 / 汇率 → 写入私有仓库 JSON → 触发 Pages 重建 → 前端自动更新。

## 模块规划

```
scripts/pipeline/
├── fetch_prices.py      # A股(akshare) / 美股港股(yfinance) / 基金(天天基金) / 加密(CoinGecko/Binance) / 黄金(上金所)
├── fetch_dividends.py   # stock_fhps_em / fund_fh_em / yfinance dividends / stock_hk_fhpx_detail_ths
├── fetch_fx.py          # Frankfurter (ECB)，仅工作日 → 周末 forward-fill
├── backfill_history.py  # 历史行情回填（加密长历史用 Binance klines）
├── quality_gate.py      # 数据质量闸门（变动>30% 标记异常 / 空源切备源 / 连续3天失败告警）
└── push_to_repo.py      # 提交 JSON 到私有仓（保持仓库活跃，防 60 天禁用）
```

## GitHub Actions 排期（PRD §5.5.1，北京时间）

| 时间 | 任务 |
|---|---|
| 06:00 | 美股/港股收盘价、加密、汇率 |
| 07:00 | 分红公告 diff 抓取 + 通知推送 |
| 16:00 | A股收盘价、黄金（上金所） |
| 21:00 | 基金净值（T+1） |
| 每周 | keepalive（防 60 天自动禁用） |

## 前置风险（P0 必做）

- **连通性验证**：Actions 境外 runner 访问东财/天天基金存在限流风险，需先跑 7 天最小 workflow 记录成功率（PRD §3.2.10）。

## 数据格式约定

- 行情/分红/汇率统一输出 `src/data/seed/*.json` 同构结构（见 `src/types/index.ts`）
- 日期 ISO `yyyy-mm-dd`；汇率 key 格式 `${from}${to}`（如 `USDCNY`）
- 前端 `useLocalStorage` 版本化 key：`dt:state:v1`，schema 变更 bump 版本自动重置

## 前端接入点

- `src/store/DataContext.tsx` 的 `buildSeedState()` 替换为从远端 JSON 加载
- `src/lib/clock.ts` 的 `SEED_TODAY` 切换为真实系统日期

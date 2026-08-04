# 个人分红 / 股息追踪系统 · Dividend Tracker

纯前端 SPA：覆盖 A股 / 港股 / 美股 / 国内公募基金 / 加密货币 / 黄金 六类资产的个人分红追踪系统。
回答三个核心问题：**持有资产能带来多少真金白银的分红？什么时候到账？到手还剩多少？**

## 快速开始

```bash
npm install
npm run dev       # 本地开发 http://localhost:5173
npm run typecheck # 零 TypeScript 错误
npm run build     # 产出 dist/（静态托管，HashRouter 零配置）
npm run preview   # 本地预览构建产物
```

## 技术栈

React 18 · Vite 5 · TypeScript 5 · Tailwind CSS 3 · ECharts 5 · react-router-dom (HashRouter) · dayjs · Context + useReducer

## 核心特性

| 模块 | 说明 |
|---|---|
| 六类资产统一模型 | 单一 `Instrument` + `market` 判别联合，税务/格式化按市场分派 |
| 持仓 = 流水推导 | `PositionEngine` 纯函数：流水 → FIFO TaxLot → Position，推导不存储 |
| ★ A股三态税务 | 已到账（税前）/ 或有税负 / 已实际扣税；`再持有 N 天税负归零` |
| 诚实预测 | 恒为区间 + 置信度 + 稳定性评分，禁止单一数字 |
| 交易所风格 UI | 深色 #0A0E14、等宽数字、tabular-nums、14 列密集持仓表 |
| 涨跌色三档 | `data-scheme="cn|intl|colorblind"` 全局统一切换 |

## 目录结构

```
src/
├── types/          # 全部 TS 接口（唯一来源）
├── styles/         # design token（唯一来源）+ 主题注入
├── data/seed/      # 六类资产演示种子数据
├── store/          # DataContext / SettingsContext / 持久化
├── lib/calc/       # 纯函数计算引擎（position/taxLot/tax/returns/prediction/fx/portfolio）
├── lib/hooks/      # 组合级派生 hooks
├── components/     # ui / layout / charts / dashboard / holdings / calendar / detail / transactions / dca / notifications / settings
└── pages/          # 9 条路由页面
```

## 数据管道（占位）

本阶段为纯前端交付。真实数据管道（Python 抓取 + GitHub Actions 定时 + Cloudflare Pages Functions 代理写入）规划见：

- `.github/workflows/README.md` — 每日 6/7/16/21 时抓取 workflow 规划（PRD §5.5.1）
- `scripts/pipeline/README.md` — Python 抓取 / 回填 / 汇率 forward-fill 规划（PRD §3.2.7）

## 演示时钟说明

种子数据与所有计算使用统一演示时钟 `2026-08-04`（见 `src/lib/clock.ts`），保证日历、税务、预测、90 天热力图首次打开即可完整演示。接入真实管道后切换到真实系统时钟即可。

## 未来扩展

1. 数据管道：Python 爬虫 → Actions 每日跑 → 提交 JSON → Pages 重建
2. 部署：Cloudflare Pages（HashRouter 零配置）+ Cloudflare Access 访问口令
3. 推送：Telegram / 飞书 / 企业微信 Webhook（设置页已预留配置项）

# 股息账本 · Dividend Tracker

一个为个人投资者设计的股息与持仓账本。日常只需“记一笔”，应用会从流水自动推导持仓、成本、收益、税务批次与未来分红。

## 产品原则

- 首页只回答：现在有多少资产、近一年收到多少分红、下一笔何时到账。
- 第一笔买入会同时建立标的和持仓，不存在“保存后看不到”的半成品状态。
- 买入、卖出、现金分红是主流程；手续费、送转、拆股等低频记录收在“更多”中。
- 手机端使用固定底部导航和卡片列表，主要操作区域不小于 44px。
- 真实个人账本只保存在本机或登录用户自己的 CloudBase 文档中，不提交到公开静态文件。

## 本地开发

需要 Node.js 22 与 pnpm 11：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

## CloudBase 配置

复制 `.env.example` 为 `.env.local`，只填写可公开的前端配置：

```bash
VITE_CLOUDBASE_ENV_ID=your-env-id
VITE_CLOUDBASE_REGION=ap-shanghai
VITE_CLOUDBASE_COLLECTION=user_ledgers
```

部署管理员 API Key 只能放在本机凭据或 GitHub Secrets，绝不能放进 `VITE_*`、源码或前端构建产物。

CloudBase 环境需要：

1. 开启静态网站托管。
2. 开启用户名/邮箱/手机号 + 密码登录，并为使用者建立账号。
3. 建立 `user_ledgers` 集合。
4. 将集合设为“仅创建者可读写”，或应用 `cloudbase/database-rules.json` 中的跨 Web / 小程序安全规则。
5. 把正式域名加入 CloudBase 安全来源。

生产构建后可部署：

```bash
pnpm build
tcb hosting deploy ./dist -e YOUR_ENV_ID
```

## 数据分层

- `localStorage`：离线与未登录状态的个人账本。
- CloudBase `user_ledgers`：登录后的个人账本，一名用户一个 `ledgerKey=primary` 文档。
- `public/data/*.json`：公开行情、汇率、分红事实与数据源状态；这里不得出现真实个人持仓。
- Python + GitHub Actions：定时刷新公开市场数据，并在测试和构建通过后部署静态站。

## 技术栈

React 18 · Vite 5 · TypeScript · Tailwind CSS · CloudBase Web SDK · Vitest。ECharts 只在详情类懒加载页面使用，不进入首页关键路径。

核心计算全部保持为纯函数，位置在 `src/lib/calc/`；11 类交易的字段归一化与验证在 `src/lib/transactionDraft.ts`，由完整类型矩阵测试保护。

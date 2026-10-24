# 当前架构

本项目是面向个人使用的股息分红追踪 SPA，部署目标为腾讯云 CloudBase。原则是：

- 交易流水是持仓、成本、收益和税务的唯一事实来源；派生结果不重复持久化。
- 首屏先显示轻量外壳，市场数据和页面代码并行加载，不用六个 JSON 阻塞路由。
- 个人账本只在本机私有存储和登录用户的 CloudBase 私有文档中保存。
- `public/data/holdings.json` 保持为空，仅用于兼容旧备份格式，绝不作为线上个人数据库。

## 运行分层

```text
pages/components
      ↓
DataContext + SettingsContext + AuthContext
      ↓
position/tax/returns/calendar 等纯函数计算
      ↓
本机 owner cache/outbox + CloudBase CAS 账本文档

市场数据：GitHub Actions → public/data/*.json → CloudBase 静态托管
```

## 云同步协议

每个 CloudBase 用户拥有一个确定性主账本文档，包含 `ownerUid`、`revision` 和完整账本快照。

1. 用户操作先同步写入按 UID 分区的本机 outbox，然后更新 React 界面。
2. 后台保存携带预期 `revision`；条件更新失败即视为另一设备已经写入。
3. 冲突时用干净基线、本机 outbox、最新云快照做三方合并：保留双方新增，识别真实删除；删除与编辑冲突采用 delete-wins 并保留冲突信息。
4. 只有服务器确认的 outbox 指纹仍是当前版本时才能清除；保存过程中产生的新编辑继续留在 outbox。
5. 所有异步读写捕获 UID 和 generation；账号切换后旧请求不能更新新账号界面。安全规则同时校验 `_openid` 与 `ownerUid`。

当前 schema 对实体采用整账本 revision，而非逐条 revision。CAS 能避免静默覆盖；同一实体的并发双改按 revision、时间戳和本地优先规则解决。

## 路由与性能

- 使用 `HashRouter`，静态托管无需 SPA fallback。
- 页面级懒加载；首页、账本列表使用轻量 SVG，不加载 ECharts。
- ECharts 只在单个标的详情页加载。
- CloudBase SDK 仅在配置环境 ID 时动态加载。
- 市场数据请求并行且单请求最多等待 8 秒；失败会显示可操作状态而非永久白屏。

## 发布

- 包管理器：pnpm。
- `pnpm test`、`pnpm build` 是部署门禁。
- `.github/workflows/fetch-data.yml` 抓取数据、验证、构建，并在全部成功后部署 `dist/`。
- CloudBase 集合规则与上线步骤见 `cloudbase/DEPLOY.md`。
- 缓存和安全响应头在 CloudBase 控制台配置，并在真实 HTTPS 地址上用响应头探测验证；Cloudflare 的 `_headers`、`_redirects` 和 Wrangler 不属于本架构。

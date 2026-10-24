# Dividend Tracker 交接文档

更新时间：2026-08-13（Asia/Shanghai）

## 1. 当前结论

这是一个面向个人投资者的股息、持仓与交易流水 SPA。当前工作区已完成移动端重构、极简记账、交易正确性、分红收益口径、离线/云同步、账号隔离、自助注册和腾讯云 CloudBase 部署。

- 线上地址：<https://dividendtracker-d9fhiinz12b42e41-1438401059.tcloudbaseapp.com>
- CloudBase 环境：`dividendtracker-d9fhiinz12b42e41`
- 地域：`ap-shanghai`
- 当前分支：`main`
- 基础提交：`6831bfe`
- 重要：当前上线版本包含大量未提交改动。压缩包保存的是实际工作区快照，接手后应先审阅并创建新提交，不要直接丢弃工作区改动。
- 最终验证：TypeScript 类型检查通过、Vite 生产构建通过、34 个测试文件共 541 项测试全部通过。

## 2. 交付内容

- `src/`：React/TypeScript 应用、账本状态、计算引擎、CloudBase 客户端与测试。
- `public/data/`：公开行情、汇率、分红事实数据；禁止写入真实个人持仓。
- `cloudbase/`：数据库规则、PostgreSQL 邀请注册 SQL、注册云函数及部署说明。
- `cloudbaserc.json`：当前 CloudBase 云函数部署配置。
- `.github/workflows/` 与 `scripts/`：行情更新、测试、构建和静态托管部署流水线。
- `dist/`：以当前生产环境变量构建、且已经上传的静态产物。
- `pnpm-lock.yaml`：锁定依赖版本；项目统一使用 pnpm，不再使用 npm lockfile。

压缩包不包含 `.git/`、`node_modules/`、本机缓存、日志和编辑器临时文件。

## 3. 产品与主要改造

- 首页聚焦资产、近 12 个月分红、下一笔分红和统一“记一笔”入口。
- 手机端使用底部导航、卡片式账本和适配 375px 宽度的日历/持仓/定投页面。
- 买入、卖出、现金分红为高频入口；低频交易类型收进“更多”。
- 第一笔买入会同时建立标的和流水，不会出现新增后不可见的空持仓。
- 11 类交易通过 `src/lib/transactionDraft.ts` 统一校验和生成。
- 卖出按交易日期校验可用持仓，避免历史回填借用未来买入数量。
- 现金分红流水与 DividendEvent 关联，收益、XIRR、TWR 和首页统计统一去重。
- 分红日历的月度金额只统计实际到账事件，避免登记日/除息日重复计算。
- 定投计划只生成待核对记录，必须逐笔填写真实成交数量和价格后才能入账。
- 首页和持仓页不再强制加载 ECharts；图表引擎只在详情页懒加载。
- 字体与启动路径已精简；核心真实规模性能测试保持在 100ms 门槛内。
- 完整账本备份覆盖流水、标的、计划、分红订正、通知和设置，并兼容旧格式。

## 4. 数据和计算边界

- `localStorage`：匿名/离线账本、同步 outbox 和用户缓存。
- PostgreSQL `public.user_ledgers`：登录用户云账本，一名用户一行，以 `user_id` 为主键。
- `revision`：乐观并发控制；跨设备冲突使用三方合并，未确认写入由持久化 outbox 保护。
- `src/lib/calc/`：FIFO、税务、汇率、持仓、XIRR、TWR 和分红计算纯函数。
- 本位币已有财务记录后锁定；展示币种仍可更换，避免历史 `fxRate` 被错误解释。
- 当前 schema 没有逐条删除墓碑，因此真正同时发生的跨设备删除冲突采用保守合并，可能保留被另一设备删除的项目，但不会静默丢失新增项目。
- 市场行情仅覆盖数据管道支持的标的；缺少有效行情时 UI 明确显示“按成本暂估/估值待更新”，不会冒充实时市值。

## 5. CloudBase 生产资源

### 静态网站

- 地址：<https://dividendtracker-d9fhiinz12b42e41-1438401059.tcloudbaseapp.com>
- 路由使用 `HashRouter`，例如 `/#/holdings`，不依赖服务器 SPA fallback。
- `dist/` 是当前已部署产物。重新部署前必须按第 8 节注入环境变量重新构建，不能上传未带环境 ID 的产物。

### PostgreSQL

- 数据库类型：CloudBase 内置 PostgreSQL。
- 账本表：`public.user_ledgers`
- 邀请表：`public.dividend_invites`
- 成员表：`public.dividend_members`
- 浏览器 SDK 必须使用 `app.rdb()`。不要把实例 ID 传给 `app.database(...)`；那会被解释成外部数据库连接器并报“数据库连接器未找到”。
- RLS 与触发器定义见 `cloudbase/postgres-invite-registration.sql`。

### 身份认证与注册

- 已开启用户名密码登录和匿名登录。
- 注册云函数：`dividend-register`
- HTTP 路由：`POST /api/register`
- 邀请码明文：不写入 GitHub，由 CloudBase 环境所有者通过安全渠道单独提供。
- 云函数只保存邀请码 SHA-256；PostgreSQL 邀请表保存 MD5，用途分别是创建账号前校验和登录后成员登记。
- 邀请码应视为敏感访问凭据，不得写入公开仓库；泄露后应立即轮换。

当前内部用户：

- `administrator`：内置超级管理员
- `liuhao`
- `wh`：2026-08-13 自助注册时账号已创建，首次成员登记曾中断。最新前端支持用同一账号、密码和邀请码再次点“注册”自动续接。

密码不写入源码或本交接包。若遗失，请由 CloudBase 环境所有者在控制台重置。

已确认 CloudBase 在创建新用户时返回过 `LimitExceeded`。当前环境只有 3 个内部用户，这可能是套餐账号数上限或短时创建限制。最新客户端会安全恢复“账号已经创建但成员登记未完成”的情况；但创建真正的新第 4 个账号仍可能失败，需要在 CloudBase 控制台确认身份认证配额、升级套餐或清理不再使用的账号。

### 云函数权限

- 注册 HTTP 路由允许匿名访问，因为用户注册前尚无身份。
- 云函数内部仍强制校验邀请码、账号格式和密码强度。
- 匿名访问不等于匿名可读账本；PostgreSQL RLS 要求已认证用户且存在 `dividend_members` 记录。
- 应在 CloudBase 网关继续保留 IP 限频，并监控异常注册请求。

## 6. 已修复的关键故障

- 登录后 `n.init is not a function`：修正 CloudBase Web SDK 初始化方式。
- 登录后“数据库连接器未找到”：PostgreSQL 从错误的 `app.database({instance...})` 改为 `app.rdb()`。
- 错误显示 `[object Object]`：递归提取 CloudBase 嵌套错误信息。
- 1 秒去抖内关页丢账：加入持久化 outbox 和恢复决策。
- 跨账号保存队列串写：所有云读写显式绑定 expected UID，并在身份变化时隔离旧账本。
- 多设备最后写覆盖：云端 `revision` CAS + 三方合并。
- 已读自动通知导致永久等待：统一 canonical fingerprint 与 hydration 逻辑。
- 匿名账本登录后被云端覆盖：匿名数据作为脏输入合并，不再静默丢弃。
- 本位币跨设备冲突、外币定投汇率、港币交叉汇率、A 股历史税批次、现金分红编辑重链等核心正确性问题均有回归测试。
- 注册出现半成功：账号创建成功但成员登记失败时，重试注册会先验证邀请码、再以原密码登录并幂等补登记。

## 7. 本地开发和验证

要求 Node.js 22、pnpm 11：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

本次快照最后验证结果：

```text
Test Files  34 passed (34)
Tests       541 passed (541)
TypeScript  passed
Vite build  passed
```

## 8. 当前生产构建参数

```bash
VITE_CLOUDBASE_ENV_ID=dividendtracker-d9fhiinz12b42e41 \
VITE_CLOUDBASE_REGION=ap-shanghai \
VITE_CLOUDBASE_COLLECTION=user_ledgers \
VITE_CLOUDBASE_DATABASE_KIND=postgresql \
VITE_CLOUDBASE_DATABASE_INSTANCE=pgdb-87m1xmm3 \
VITE_CLOUDBASE_DATABASE_NAME=pgdb-87m1xmm3 \
VITE_CLOUDBASE_MEMBERS_TABLE=dividend_members \
VITE_CLOUDBASE_REGISTER_FUNCTION=dividend-register \
VITE_CLOUDBASE_REGISTER_ENDPOINT=/api/register \
pnpm build
```

`DATABASE_INSTANCE` 和 `DATABASE_NAME` 当前为部署兼容配置；内置 PostgreSQL 的浏览器访问实际使用无参数 `app.rdb()`。

部署：

```bash
tcb login
tcb fn deploy dividend-register -e dividendtracker-d9fhiinz12b42e41 --force
tcb hosting deploy ./dist -e dividendtracker-d9fhiinz12b42e41 --concurrency 5 --retry-count 3
```

这是部署到他人账号的项目。切换 CloudBase 所有人或目标环境时，必须让目标账号持有人重新扫码登录；不得复制本机登录缓存、管理员 API Key 或旧账号凭据。

## 9. 部署后验收

1. 以 375px 宽度打开首页、账本、持仓、日历、定投和设置。
2. 登录后记录一笔买入，刷新页面，确认流水和持仓仍存在。
3. 记录现金分红，确认首页近 12 月分红和日历到账金额同步变化且不重复。
4. 用有效邀请码注册；错误邀请码必须在创建账号前被拒绝。
5. 退出后不得显示前一账号账本；两账号之间必须无法读取对方数据。
6. 两台设备同时修改后确认 CAS 冲突能合并且不静默丢账。
7. 检查静态 `public/data/holdings.json` 为空，不得把真实持仓提交到公开资源。
8. 在 CloudBase 控制台检查静态资源缓存策略、HTTP 注册路由限频、认证配额和 PostgreSQL RLS。

## 10. 接手后的优先事项

1. 先完成 `wh` 的注册续接测试，并验证它可创建/刷新云账本。
2. 在 CloudBase 控制台确认 `LimitExceeded` 的具体配额；若计划多人使用，先解决内部用户上限。
3. 将当前工作区改动审阅后提交到独立分支或 PR，避免已部署源码只存在于本地压缩包。
4. 为真实生产域名配置缓存和注册接口限频；默认 `tcloudbaseapp.com` 域名更适合个人/测试使用。
5. 若未来需要可靠同步“删除”，升级账本 schema，为实体加入逐条 revision/updatedAt 和 tombstone。
6. 定期做完整 JSON 账本备份，并在独立测试账号验证导出—清空—导入回环。

## 11. 安全提醒

- 不要把账号密码、CloudBase 管理员 API Key、CAM SecretId/SecretKey 写入源码、`.env`、GitHub 普通变量或前端 `VITE_*`。
- `VITE_*` 会进入浏览器产物，只能放公开配置。
- 邀请码泄露后应立即轮换云函数 SHA-256 和数据库邀请码记录。
- 本交接文档不包含账号密码、管理员密钥或邀请码明文。

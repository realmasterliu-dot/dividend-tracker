# CloudBase 上线清单

## 环境资源

1. 在目标账号中确认 CloudBase 环境 ID 与地域。
2. 开启静态网站托管、数据库和身份认证。项目同时支持文档数据库和 PostgreSQL。
3. 文档数据库：创建集合 `user_ledgers`，在集合权限管理中切换到安全规则，
   并粘贴 `database-rules.json`。
4. PostgreSQL：创建 `public.user_ledgers`，字段为 `user_id text primary key`、
   `data jsonb not null`、`settings jsonb not null`、`updated_at timestamptz not null
   default now()`、`revision integer not null default 1`；启用 RLS，并使用
   `uid() = user_id` 作为读写检查。若启用自助注册，再执行
   `postgres-invite-registration.sql`，创建邀请与成员表并收紧账本权限。
5. 开启账号密码登录和匿名登录。自助注册只接受有效邀请码；邀请码仅以散列值保存在
   `public.dividend_invites`，不要把明文写进前端配置。
6. 部署 `dividend-register` 云函数，并在静态托管域名上创建 `/api/register` HTTP 路由，
   上游为该函数、关闭路由身份认证、开启安全域名并配置 IP 限频。函数内部仍会校验邀请码。
7. 将托管域名加入安全来源列表。

文档数据库通过 `_openid` 与不可变 `ownerUid` 隔离账号；PostgreSQL 通过
`user_id` 主键和 RLS 隔离账号。两种存储都使用递增的 `revision` 检测两台设备同时修改，
并触发三方合并。

## 构建与本机部署

```bash
VITE_CLOUDBASE_ENV_ID=目标环境ID pnpm build
tcb login
tcb hosting deploy ./dist -e 目标环境ID
```

PostgreSQL 环境还需设置 `VITE_CLOUDBASE_DATABASE_KIND=postgresql`、
`VITE_CLOUDBASE_DATABASE_INSTANCE` 和 `VITE_CLOUDBASE_DATABASE_NAME`。
GitHub Actions 对应 Secrets 为 `TENCENT_DATABASE_KIND`、
`TENCENT_DATABASE_INSTANCE`、`TENCENT_DATABASE_NAME`。
成员表默认是 `dividend_members`，可通过 `VITE_CLOUDBASE_MEMBERS_TABLE` 覆盖。
注册接口默认使用同域名 `/api/register`，可通过
`VITE_CLOUDBASE_REGISTER_ENDPOINT` 覆盖。

这是部署到他人账号的项目：执行 `tcb login` 时必须由目标账号持有人完成新的设备授权，不得复用 handover 中旧环境的凭据。

## 部署后验收

- 375px 手机宽度下打开首页、记一笔、账本、日历和更多。
- 登录测试账号，新增一笔买入；刷新后记录仍在。
- 用有效邀请码注册新账号；用错误邀请码注册时不得获得账本权限。
- 退出后不再显示上一位用户数据；再次登录可恢复。
- 用两个账号交叉验证，彼此无法读取对方账本。
- 检查 `/data/holdings.json` 为空，静态资源中不存在个人数据或管理员 API Key。
- 在 CloudBase 控制台为 `/assets/*` 配长缓存、`/data/*` 配短缓存，并从真实站点检查响应头。

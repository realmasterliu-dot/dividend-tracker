/**
 * CloudBase 前端配置。
 *
 * 仅 envId 会进入浏览器构建产物；管理员 API Key / SecretKey 绝不能放在这里。
 * 未配置时应用完整保留本地账本能力，方便离线使用与本地开发。
 */
export const cloudConfig = {
  envId: String(import.meta.env.VITE_CLOUDBASE_ENV_ID ?? '').trim(),
  region: String(import.meta.env.VITE_CLOUDBASE_REGION ?? 'ap-shanghai').trim(),
  collection: String(import.meta.env.VITE_CLOUDBASE_COLLECTION ?? 'user_ledgers').trim(),
  databaseKind: String(
    import.meta.env.VITE_CLOUDBASE_DATABASE_KIND ?? 'document',
  ).trim() as 'document' | 'postgresql',
  databaseInstance: String(
    import.meta.env.VITE_CLOUDBASE_DATABASE_INSTANCE ?? '',
  ).trim(),
  databaseName: String(import.meta.env.VITE_CLOUDBASE_DATABASE_NAME ?? '').trim(),
  membersTable: String(
    import.meta.env.VITE_CLOUDBASE_MEMBERS_TABLE ?? 'dividend_members',
  ).trim(),
  registerFunction: String(
    import.meta.env.VITE_CLOUDBASE_REGISTER_FUNCTION ?? 'dividend-register',
  ).trim(),
  registerEndpoint: String(
    import.meta.env.VITE_CLOUDBASE_REGISTER_ENDPOINT ?? '/api/register',
  ).trim(),
} as const;

export const cloudEnabled = cloudConfig.envId.length > 0;

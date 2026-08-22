# 数据与部署流水线

实际工作流位于 `.github/workflows/fetch-data.yml`，不再是占位方案。

## 执行顺序

1. 安装 Python 数据依赖并抓取行情、汇率、分红和来源健康状态。
2. 运行数据质量门禁，生成 `public/data/*.json`。
3. 使用锁定版本的 pnpm 安装前端依赖。
4. 运行完整测试和 TypeScript / Vite 生产构建。
5. 只有以上步骤全部成功，才用 CloudBase CLI 将 `dist/` 部署到目标环境根路径。

## 必需 Secrets

- `TENCENT_ENV_ID`：CloudBase 环境 ID，同时注入前端构建。
- `TENCENT_CLOUDBASE_API_KEY`：目标环境的 CloudBase 环境 API Key，仅供 CI 部署；不能是前端公开 Key，也不能写入 Vite 变量。

个人账本不进入 GitHub Actions、仓库或静态数据产物。自动化只处理公开市场数据。

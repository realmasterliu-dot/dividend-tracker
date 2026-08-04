# GitHub Actions Workflow 规划（占位 · 本阶段不实现）

> 本阶段为纯前端交付；以下为未来定时数据管道的 workflow 规划（PRD §5.5.1）。

## 规划文件

```
.github/workflows/
├── fetch-data.yml      # 每日 6/7/16/21 时抓取（A股/港美股/基金/加密/黄金/汇率）
├── connectivity-test.yml  # P0 前置：7 天连通性验证（境外 runner 访问 A股源成功率）
└── keepalive.yml       # 每月 keepalive（防 60 天无活动自动禁用）
```

## fetch-data.yml 骨架（占位）

```yaml
name: fetch-data
on:
  schedule:
    - cron: '0 22 * * *'   # 06:00 北京时间
    - cron: '0 23 * * *'   # 07:00
    - cron: '0 8 * * *'    # 16:00
    - cron: '0 13 * * *'   # 21:00
  workflow_dispatch:

jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r scripts/pipeline/requirements.txt
      - run: python scripts/pipeline/fetch_all.py
      - name: Commit data
        run: |
          git config user.name "pipeline-bot"
          git config user.email "pipeline@example.com"
          git add src/data/seed/*.json
          git commit -m "data: daily refresh $(date -u +%Y-%m-%d)" || true
          git push
```

## 风险缓解

| 风险 | 缓解 |
|---|---|
| 60 天无活动自动禁用 | 每日成功后提交数据 commit（天然保持活动）+ 每月 keepalive |
| 境外访问 A股源限流 | P0 先做连通性验证 7 天；备选 Tushare Pro / 镜像源 / 本地定时推送 |
| 免费源改版解析失败 | 多源降级链 + 数据质量闸门 + 前端"陈旧 N 天"角标 |

## 安全

- Webhook Token / API Key 存 GitHub Secrets 与 Cloudflare 环境变量，不入代码库（PRD §10.4）
- Actions 日志脱敏，不打印持仓金额

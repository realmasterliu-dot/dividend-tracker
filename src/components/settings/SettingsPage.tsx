import React, { useState } from 'react';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { AppearanceSettings } from './AppearanceSettings';
import { TaxSettings } from './TaxSettings';
import { DataSettings } from './DataSettings';

/** 设置页容器（四项开放问题默认值可改 + 数据源健康面板） */
export function SettingsPage() {
  const { state } = useData();
  const { settings, update } = useSettings();
  const [tg, setTg] = useState(settings.notificationChannels.telegram ?? '');
  const [fs, setFs] = useState(settings.notificationChannels.feishu ?? '');
  const [wc, setWc] = useState(settings.notificationChannels.wecom ?? '');

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div>
        <h2 className="text-[18px] font-bold text-primary">设置</h2>
        <p className="text-[12px] text-secondary mt-0.5">
          开放问题默认化：本位币 CNY · W-8BEN 未填(30%保守) · 涨跌色中国习惯 · 黄金实物金条
        </p>
      </div>

      <AppearanceSettings />
      <TaxSettings />

      <Card title="通知渠道" subtitle="本阶段仅站内通知中心；Webhook 留配置项，无真实推送" bodyClassName="p-4 space-y-3">
        <Input label="Telegram Bot Token / Chat ID" value={tg} onChange={(e) => { setTg(e.target.value); update({ notificationChannels: { ...settings.notificationChannels, telegram: e.target.value } }); }} placeholder="可选" />
        <Input label="飞书 Webhook URL" value={fs} onChange={(e) => { setFs(e.target.value); update({ notificationChannels: { ...settings.notificationChannels, feishu: e.target.value } }); }} placeholder="可选" />
        <Input label="企业微信 Webhook URL" value={wc} onChange={(e) => { setWc(e.target.value); update({ notificationChannels: { ...settings.notificationChannels, wecom: e.target.value } }); }} placeholder="可选" />
        <div className="text-[11px] text-disabled">密钥应存 GitHub Secrets / Cloudflare 环境变量，不入代码库（PRD §10.4）</div>
      </Card>

      <Card title="数据源健康度（P3 面板）" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>数据源</th>
                <th>最近成功</th>
                <th className="text-right">连续失败</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(state.sourceHealth).map(([name, h]) => (
                <tr key={name}>
                  <td className="text-primary">{name}</td>
                  <td className="font-mono text-secondary">{h.lastSuccess.slice(0, 16).replace('T', ' ')}</td>
                  <td className="num">{h.consecutiveFailures}</td>
                  <td>
                    <Badge variant={h.status === 'GREEN' ? 'green' : h.status === 'YELLOW' ? 'orange' : 'red'}>
                      {h.status === 'GREEN' ? '🟢 正常' : h.status === 'YELLOW' ? '🟡 降级' : '🔴 异常'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 text-[11px] text-disabled border-t border-line-soft">
          同花顺·港股分红连续失败 3 天 → 健康灯转红（演示降级链：yfinance 备源 + 手动录入兜底）
        </div>
      </Card>

      <DataSettings />
    </div>
  );
}

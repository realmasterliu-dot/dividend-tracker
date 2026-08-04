import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { useSettings } from '@/store/SettingsContext';
import { useDividendCalendar } from '@/lib/hooks/useDividendCalendar';
import { selectCashflow12m } from '@/store/selectors';
import { TotalAssetHero } from '@/components/dashboard/TotalAssetHero';
import { ReturnBreakdownCard } from '@/components/dashboard/ReturnBreakdownCard';
import { YieldDualCard } from '@/components/dashboard/YieldDualCard';
import { ReturnMetricsCard } from '@/components/dashboard/ReturnMetricsCard';
import { TodoPanel } from '@/components/dashboard/TodoPanel';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { AssetTrendChart } from '@/components/charts/AssetTrendChart';
import { CalendarHeatmap } from '@/components/charts/CalendarHeatmap';
import { DividendBarChart, DividendBarDatum } from '@/components/charts/DividendBarChart';
import { stabilityDots, formatPctPlain } from '@/lib/format';
import { formatNumber } from '@/lib/format';
import { yearOf } from '@/lib/clock';

/** Dashboard：九区块（TickerTape 在 TopBar；此处含 2-9 区块）PRD §8.4.1 */
export function DashboardPage() {
  const portfolio = usePortfolio();
  const { settings } = useSettings();
  const { heatmap } = useDividendCalendar();
  const cashflow = useMemo(() => selectCashflow12m(portfolio.enrichedDividends), [portfolio.enrichedDividends]);
  const [segment, setSegment] = useState<'all' | 'income' | 'growth'>('all');

  // 年度分红柱状图数据（已收实线金柱 / 预测虚线灰柱 / 特别股息斜纹）
  const barData = useMemo<DividendBarDatum[]>(() => {
    const map = new Map<number, DividendBarDatum>();
    const years = [...new Set(
      portfolio.enrichedDividends.map((d) =>
        yearOf(d.payDate ?? d.exDate ?? d.recordDate ?? '2026-01-01'),
      ),
    )].sort((a, b) => a - b);
    for (const y of years) {
      map.set(y, { year: y, declared: 0, predicted: 0, special: 0, isCurrentYear: y === 2026 });
    }
    for (const d of portfolio.enrichedDividends) {
      const y = yearOf(d.payDate ?? d.exDate ?? d.recordDate ?? '2026-01-01');
      const entry = map.get(y);
      if (!entry) continue;
      if (d.isSpecial) entry.special += d.netAmount;
      else if (['PAID', 'RECONCILED', 'DECLARED', 'EX_DIVIDEND'].includes(d.status)) entry.declared += d.netAmount;
      else entry.predicted += d.netAmount;
    }
    return [...map.values()];
  }, [portfolio.enrichedDividends]);

  const filteredPositions =
    segment === 'income'
      ? portfolio.positions.filter((p) => p.instrument.dividendEligible)
      : segment === 'growth'
        ? portfolio.positions.filter((p) => !p.instrument.dividendEligible)
        : portfolio.positions;

  return (
    <div className="p-4 space-y-4">
      {/* 红色横幅：>48h 未更新（PRD §3.2.10） */}
      {portfolio.staleCount > 0 && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          ⚠ 数据陈旧告警：{portfolio.staleCount} 只标的价格超过阈值未更新，请检查数据源健康（同花顺·港股分红 🔴）
        </div>
      )}

      {/* W-8BEN 黄色横幅（PRD §3.2.3） */}
      {!settings.w8benFilled && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning flex items-center gap-2">
          ⚠ 美股预扣税率未确认，当前按 30% 保守估算
          <Link to="/settings" className="underline underline-offset-2 hover:text-warning/80">[去设置]</Link>
        </div>
      )}

      {/* 汇率中性模式徽章 */}
      {settings.fxNeutralMode && (
        <div className="flex justify-end">
          <Badge variant="blue">汇率中性模式：已剥离汇兑损益</Badge>
        </div>
      )}

      {/* 2. 总资产大数字 */}
      <TotalAssetHero />

      {/* 3. 三段回报拆解 + 双口径股息率 + 收益率指标 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ReturnBreakdownCard />
        <YieldDualCard />
        <ReturnMetricsCard />
      </div>

      {/* 资产二分切换（PRD §6.2②） */}
      <div className="flex items-center gap-2">
        <div className="flex rounded border border-line overflow-hidden text-[11px]">
          {([
            { key: 'all', label: '全部' },
            { key: 'income', label: '仅收益型' },
            { key: 'growth', label: '仅增值型' },
          ] as const).map((s) => (
            <button
              key={s.key}
              onClick={() => setSegment(s.key)}
              className={`px-3 py-1 ${segment === s.key ? 'bg-gold/15 text-gold' : 'text-secondary hover:text-primary'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-disabled">
          {filteredPositions.length} 只 · 市值合计
          <span className="num text-primary ml-1">{formatNumber(filteredPositions.reduce((s, p) => s + p.marketValue, 0) / 10000, 1)}万</span>
        </span>
      </div>

      {/* 4. 资产走势曲线（近似重建） */}
      <Card
        title="资产走势"
        subtitle="市值 / 累计投入 / 累计分红（金）"
        bodyClassName="p-3"
      >
        <AssetTrendChart snapshots={portfolio.snapshots} baseCurrency={settings.baseCurrency} />
      </Card>

      {/* 5. 90 天分红日历热力图 */}
      <Card
        title="未来 90 天分红热力图"
        subtitle="颜色深浅 = 当日分红金额"
        action={
          <Link to="/calendar">
            <Button size="sm" variant="ghost">打开日历 →</Button>
          </Link>
        }
        bodyClassName="p-3"
      >
        <CalendarHeatmap cells={heatmap} baseCurrency={settings.baseCurrency} />
      </Card>

      {/* 6. 年度分红柱状图 */}
      <Card
        title="年度分红"
        subtitle="已收 = 实线金柱 · 预测 = 虚线灰柱（区间） · 特别股息 = 斜纹柱（已剔除）"
        bodyClassName="p-3"
      >
        <DividendBarChart data={barData} showSpecial />
      </Card>

      {/* 7-8. 双口径 + 指标已在上方；此处放预测现金流表 */}
      <Card
        title="未来 12 个月预计分红现金流"
        subtitle="区间 + 置信度（拒绝单一数字）· 已宣告值覆盖预测值"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>月份</th>
                <th className="text-right">已宣告</th>
                <th className="text-right">预测区间</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {cashflow.map((m) => (
                <tr key={m.month}>
                  <td className="font-mono text-primary">{m.month}</td>
                  <td className="num text-gold">{m.declared > 0 ? formatNumber(m.declared, 0) : '—'}</td>
                  <td className="num text-secondary">
                    {m.lower > 0 || m.upper > 0 ? `${formatNumber(m.lower, 0)} – ${formatNumber(m.upper, 0)}` : '—'}
                  </td>
                  <td className="text-secondary max-w-[220px] truncate">
                    {m.items.map((i) => i.instrumentId).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-line-soft text-[10px] text-disabled">
          * 预测基于近 3 年派息历史统计外推，不构成任何保证；已宣告分红以实施公告为准
        </div>
      </Card>

      {/* 预测卡片：每只分红标的的区间 + 置信度 + 稳定性 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {portfolio.positions
          .filter((p) => p.instrument.dividendEligible)
          .map((p) => {
            const pred = portfolio.predictions[p.instrumentId];
            if (!pred || pred.method === 'NONE') return null;
            return (
              <Card key={p.instrumentId} title={p.instrument.name} subtitle={p.instrument.symbol} bodyClassName="p-3">
                <div className="flex items-baseline gap-2">
                  <span className="num text-gold text-[18px] font-bold">
                    {formatNumber(pred.lower, 0)} – {formatNumber(pred.upper, 0)}
                  </span>
                  <Badge variant="cyan">预测</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-secondary">
                  <span>
                    置信度{' '}
                    <Badge variant={pred.confidence === 'HIGH' ? 'green' : pred.confidence === 'MED' ? 'orange' : 'gray'}>
                      {pred.confidence === 'HIGH' ? '高' : pred.confidence === 'MED' ? '中' : '低'}
                    </Badge>
                  </span>
                  <span>
                    稳定性 {stabilityDots(pred.stabilityScore)} {pred.stabilityScore}/5
                  </span>
                  <span>样本 {pred.sampleYears} 年 · {pred.frequency}</span>
                </div>
                <div className="mt-1.5 text-[11px] text-disabled">{pred.note}</div>
                {pred.specialDividendsExcluded.length > 0 && (
                  <div className="mt-1 text-[10px] text-warning">已剔除特别股息 {pred.specialDividendsExcluded.length} 笔</div>
                )}
              </Card>
            );
          })}
      </div>

      {/* 9. 待办区 */}
      <TodoPanel />
    </div>
  );
}

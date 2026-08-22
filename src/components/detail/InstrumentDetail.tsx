import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { useTaxBreakdown } from '@/lib/hooks/useTaxBreakdown';
import { formatMoney, formatPctPlain } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { MarketBadge } from '@/components/holdings/MarketBadge';
import { yearOf } from '@/lib/clock';
import { KlineChart, KlinePoint } from '@/components/charts/KlineChart';
import { DividendBarChart, DividendBarDatum } from '@/components/charts/DividendBarChart';
import { TaxBreakdownCard, hongKongCustodyLabel } from './TaxBreakdownCard';
import { TaxLotTable } from './TaxLotTable';
import { DividendHistoryTable } from './DividendHistoryTable';
import { accountingDividendEvents } from '@/lib/transactionDividend';

/** 标的详情容器：K线 + 分红柱 + 税务拆解 + TaxLot + 分红历史（PRD §8.4.4） */
export function InstrumentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state } = useData();
  const { settings } = useSettings();
  const { lots } = useTaxBreakdown(id ?? '');

  const [range, setRange] = useState<30 | 60 | 250>(250);

  const instrument = state.instruments.find((i) => i.id === id);
  const currency = settings.displayCurrency;
  const instrumentDividends = useMemo(
    () => accountingDividendEvents(state.dividends).filter((dividend) => dividend.instrumentId === id),
    [state.dividends, id],
  );

  const klineData = useMemo<KlinePoint[]>(() => {
    const series = state.prices
      .filter((p) => p.instrumentId === id)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-range);
    let prevClose = series[0]?.price ?? 0;
    return series.map((p) => {
      const open = prevClose || p.price;
      const high = Math.max(open, p.price) * 1.002;
      const low = Math.min(open, p.price) * 0.998;
      prevClose = p.price;
      return { date: p.date, open, close: p.price, low, high };
    });
  }, [state.prices, id, range]);

  const exDates = useMemo(
    () =>
      state.dividends
        .filter((d) => d.instrumentId === id && d.exDate)
        .map((d) => d.exDate!)
        .sort(),
    [state.dividends, id],
  );

  const barData = useMemo<DividendBarDatum[]>(() => {
    const yearMap = new Map<number, DividendBarDatum>();
    const enriched = instrumentDividends;
    const years = [...new Set(enriched.map((d) => yearOf(d.payDate ?? d.exDate ?? d.recordDate ?? '2026-01-01')))].sort(
      (a, b) => a - b,
    );
    for (const y of years) {
      yearMap.set(y, { year: y, declared: 0, predicted: 0, special: 0, isCurrentYear: y === 2026 });
    }
    for (const d of enriched) {
      const y = yearOf(d.payDate ?? d.exDate ?? d.recordDate ?? '2026-01-01');
      const entry = yearMap.get(y);
      if (!entry) continue;
      if (d.isSpecial) entry.special += d.netAmount;
      else if (d.status === 'PAID' || d.status === 'RECONCILED' || d.status === 'DECLARED' || d.status === 'EX_DIVIDEND')
        entry.declared += d.netAmount;
      else entry.predicted += d.netAmount;
    }
    return [...yearMap.values()];
  }, [instrumentDividends]);

  if (!instrument) {
    return (
      <div className="p-6">
        <EmptyState
          title="找不到这个标的"
          description="它可能已被删除，或当前链接已经失效。"
          action={
            <Button onClick={() => navigate('/holdings')}>返回持仓</Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <button
        onClick={() => navigate('/holdings')}
        className="flex items-center gap-1 text-[12px] text-secondary hover:text-primary"
      >
        <ArrowLeft size={14} /> 返回持仓
      </button>

      {/* 头部信息 */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[22px] font-bold text-primary">{instrument.name}</span>
        <span className="font-mono text-secondary">{instrument.symbol}</span>
        <MarketBadge market={instrument.market} />
        <Badge variant={instrument.dividendEligible ? 'gold' : 'gray'}>
          {instrument.dividendEligible ? '可分红' : '不分红'}
        </Badge>
        {instrument.market === 'HK' && (
          <Badge variant={instrument.custodyChannel === 'HK_LOCAL_BROKER' ? 'cyan' : 'orange'}>
            {hongKongCustodyLabel(instrument.custodyChannel)}
          </Badge>
        )}
        {instrument.market === 'US' && (
          <Badge variant="orange">{settings.w8benFilled ? 'W-8BEN 已填 10%' : 'W-8BEN 未填 30% 保守'}</Badge>
        )}
      </div>

      {/* K线 */}
      <Card
        title="价格 K 线"
        subtitle="除息日标记为橙色 pin"
        action={
          <div className="flex rounded border border-line overflow-hidden text-[11px]">
            {([30, 60, 250] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2 py-0.5 ${range === r ? 'bg-gold/15 text-gold' : 'text-secondary hover:text-primary'}`}
              >
                {r}日
              </button>
            ))}
          </div>
        }
        bodyClassName="p-3"
      >
        <KlineChart data={klineData} exDates={exDates} currency={instrument.currency} />
      </Card>

      {/* 分红柱状图 */}
      <Card
        title="年度分红"
        subtitle="已到账/已宣告 = 实线金柱 · 预测 = 虚线灰柱 · 特别股息 = 斜纹柱（已从预测中剔除）"
        bodyClassName="p-3"
      >
        <DividendBarChart data={barData} showSpecial />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TaxBreakdownCard instrumentId={instrument.id} />
        <TaxLotTable lots={lots} />
      </div>

      <DividendHistoryTable dividends={instrumentDividends} />
    </div>
  );
}

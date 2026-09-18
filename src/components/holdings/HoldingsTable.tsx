import React, { useMemo } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import type { Position, PriceSnapshot } from '@/types';
import { Table, TableColumn } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { MarketBadge } from './MarketBadge';
import { LightweightSparkline } from './LightweightSparkline';
import { Badge } from '@/components/ui/Badge';
import { useData } from '@/store/DataContext';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatNumber, formatPercent, formatQuantity } from '@/lib/format';

interface HoldingsTableProps {
  /** 打开全局「记一笔」面板；未提供时空态只显示操作提示。 */
  onRecord?: () => void;
}

function latestValidQuoteIds(prices: PriceSnapshot[]): Set<string> {
  const latestValidDates = new Map<string, string>();
  for (const price of prices) {
    if (!Number.isFinite(price.price) || price.price <= 0) continue;
    const currentDate = latestValidDates.get(price.instrumentId);
    if (!currentDate || price.date > currentDate) latestValidDates.set(price.instrumentId, price.date);
  }
  return new Set(latestValidDates.keys());
}

function HoldingDetail({
  position,
  priceSeries,
  hasMarketPrice,
}: {
  position: Position;
  priceSeries: number[];
  hasMarketPrice: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 p-4 lg:grid-cols-2 lg:p-5">
      <div className="min-w-0">
        <div className="mb-2 text-[11px] font-medium text-secondary">买入批次</div>
        <div className="overflow-x-auto">
          <table className="tbl min-w-[420px] text-[11px]">
            <thead>
              <tr>
                <th>买入日</th>
                <th className="text-right">剩余数量</th>
                <th className="text-right">本币成本价</th>
              </tr>
            </thead>
            <tbody>
              {position.lots.map((lot) => (
                <tr key={lot.id}>
                  <td className="font-mono">{lot.originalBuyDate}</td>
                  <td className="num">{formatQuantity(lot.quantity, position.instrument.market)}</td>
                  <td className="num">{formatNumber(lot.costPerShareLocal, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-medium text-secondary">
          <span>近 30 个行情点</span>
          {!hasMarketPrice && <span className="font-normal text-warning">暂无行情，估值按成本暂估</span>}
        </div>
        <LightweightSparkline
          data={priceSeries}
          positive={hasMarketPrice ? position.unrealizedPnl >= 0 : undefined}
          height={72}
        />
      </div>
    </div>
  );
}

/**
 * 持仓列表：桌面端保留可排序表格，手机端改为可触摸的摘要卡片。
 * 次要指标仍可从桌面列设置或标的详情中查看，避免在首屏堆满 14 列。
 */
export function HoldingsTable({ onRecord }: HoldingsTableProps = {}) {
  const navigate = useNavigate();
  const { state } = useData();
  const { positions } = usePortfolio();
  const { money, signed } = useMoneyFmt();

  const sortedPositions = useMemo(
    () => [...positions].sort((a, b) => b.marketValue - a.marketValue),
    [positions],
  );

  const validQuoteIds = useMemo(() => latestValidQuoteIds(state.prices), [state.prices]);

  const priceSeriesByInstrument = useMemo(() => {
    const snapshots = new Map<string, PriceSnapshot[]>();
    for (const p of state.prices) {
      if (!Number.isFinite(p.price) || p.price <= 0) continue;
      const list = snapshots.get(p.instrumentId) ?? [];
      list.push(p);
      snapshots.set(p.instrumentId, list);
    }

    const map = new Map<string, number[]>();
    for (const [key, values] of snapshots) {
      map.set(
        key,
        values
          .sort((left, right) => left.date.localeCompare(right.date))
          .slice(-30)
          .map((item) => item.price),
      );
    }
    return map;
  }, [state.prices]);

  const columns = useMemo<TableColumn<Position>[]>(() => {
    return [
      {
        key: 'instrument',
        title: '标的',
        align: 'left',
        width: '210px',
        sortValue: (p) => p.instrument.symbol,
        hideable: false,
        render: (p) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-medium text-primary">{p.instrument.symbol}</span>
              <MarketBadge market={p.instrument.market} />
            </div>
            <span className="mt-0.5 block max-w-[190px] truncate text-[11px] text-secondary" title={p.instrument.name}>
              {p.instrument.name}
            </span>
          </div>
        ),
      },
      {
        key: 'quantity',
        title: '持有',
        align: 'right',
        sortValue: (p) => p.totalQuantity,
        render: (p) => (
          <div>
            <span className="num text-primary">{formatQuantity(p.totalQuantity, p.instrument.market)}</span>
            <span className="mt-0.5 block text-[10px] text-disabled">
              成本 {formatNumber(p.avgCostPerShareLocal, 2)}
            </span>
          </div>
        ),
      },
      {
        key: 'price',
        title: '现价',
        align: 'right',
        sortValue: (p) => (validQuoteIds.has(p.instrumentId) ? p.marketPrice : -1),
        render: (p) => {
          const hasMarketPrice = validQuoteIds.has(p.instrumentId);
          if (!hasMarketPrice) return <Badge variant="orange">暂无行情</Badge>;
          return (
            <div>
              <span className="num text-primary">{formatNumber(p.marketPrice, 2)}</span>
              {p.staleDays > 0 && (
                <Badge variant="orange" className="mt-0.5 block" title={`最新价格为 ${p.staleDays} 天前`}>
                  {p.staleDays} 天前
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        key: 'marketValue',
        title: '市值 / 参考',
        align: 'right',
        sortValue: (p) => p.marketValue,
        hideable: false,
        render: (p) =>
          validQuoteIds.has(p.instrumentId) ? (
            <span className="num font-medium text-primary">{money(p.marketValue, 0)}</span>
          ) : (
            <div>
              <span className="num block font-medium text-primary">{money(p.costValueCurrentFx, 0)}</span>
              <span className="mt-0.5 block text-[10px] text-warning">按成本暂估</span>
            </div>
          ),
      },
      {
        key: 'pnl',
        title: '浮动盈亏',
        align: 'right',
        sortValue: (p) => p.unrealizedPnl,
        hideable: false,
        render: (p) => {
          if (!validQuoteIds.has(p.instrumentId)) {
            return <span className="text-[11px] text-disabled">待行情</span>;
          }
          const positive = p.unrealizedPnl >= 0;
          return (
            <div className={clsx('num', positive ? 'text-up' : 'text-down')}>
              <span>{signed(p.unrealizedPnl, 0)}</span>
              <span className="mt-0.5 block text-[11px] opacity-80">
                {formatPercent(p.unrealizedPnlPct)}
              </span>
            </div>
          );
        },
      },
      {
        key: 'dividend',
        title: '预计分红',
        align: 'right',
        sortValue: (p) => p.annualDividend,
        render: (p) =>
          p.instrument.dividendEligible ? (
            <div className="num text-gold">
              <span>{money(p.annualDividend, 0)}/年</span>
              <span className="mt-0.5 block text-[11px] opacity-80">
                {validQuoteIds.has(p.instrumentId)
                  ? `股息率 ${formatPercent(p.dividendYield)}`
                  : '收益率待行情'}
              </span>
            </div>
          ) : (
            <span className="text-disabled">—</span>
          ),
      },
    ];
  }, [money, signed, validQuoteIds]);

  if (sortedPositions.length === 0) {
    return (
      <EmptyState
        title="还没有持仓"
        description="记下第一笔买入后，这里会自动汇总数量、市值和预计分红。"
        action={
          onRecord ? (
            <Button variant="gold" className="min-h-11 px-4" onClick={onRecord}>
              <Plus size={16} /> 记一笔
            </Button>
          ) : (
            <span className="text-[12px] text-secondary">点击页面下方的「记一笔」开始记录</span>
          )
        }
      />
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table
          columns={columns}
          rows={sortedPositions}
          rowKey={(p) => p.instrumentId}
          rowClassName={(p) => clsx(p.staleDays > 0 && 'opacity-90')}
          expandable={(p) => (
            <HoldingDetail
              position={p}
              priceSeries={priceSeriesByInstrument.get(p.instrumentId) ?? []}
              hasMarketPrice={validQuoteIds.has(p.instrumentId)}
            />
          )}
          defaultSortKey="marketValue"
          className="max-h-[calc(100vh-220px)]"
          dense
        />
      </div>

      <div className="space-y-2 md:hidden">
        {sortedPositions.map((position) => {
          const hasMarketPrice = validQuoteIds.has(position.instrumentId);
          const positive = position.unrealizedPnl >= 0;
          return (
            <button
              key={position.instrumentId}
              type="button"
              onClick={() => navigate(`/instruments/${position.instrumentId}`)}
              className="min-h-11 w-full rounded-xl border border-line bg-card p-4 text-left transition-colors active:bg-card-hover"
              aria-label={`查看 ${position.instrument.name} 详情`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-primary">
                      {position.instrument.name}
                    </span>
                    <MarketBadge market={position.instrument.market} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[12px] text-secondary">
                    <span className="font-mono">{position.instrument.symbol}</span>
                    <span>持有 {formatQuantity(position.totalQuantity, position.instrument.market)}</span>
                  </div>
                </div>
                <ChevronRight size={18} className="mt-1 shrink-0 text-disabled" />
              </div>

              <div className="mt-4 flex items-end justify-between gap-4">
                <div>
                  <div className="text-[11px] text-secondary">{hasMarketPrice ? '市值' : '参考金额'}</div>
                  <div className="num mt-0.5 text-[20px] font-semibold text-primary">
                    {money(hasMarketPrice ? position.marketValue : position.costValueCurrentFx, 0)}
                  </div>
                  {!hasMarketPrice && <div className="mt-0.5 text-[10px] text-warning">按成本暂估</div>}
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-secondary">浮动盈亏</div>
                  {hasMarketPrice ? (
                    <div className={clsx('num mt-0.5 text-[15px] font-medium', positive ? 'text-up' : 'text-down')}>
                      {signed(position.unrealizedPnl, 0)} · {formatPercent(position.unrealizedPnlPct)}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[13px] text-disabled">待行情</div>
                  )}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line/70 pt-3 text-[12px]">
                <div>
                  <span className="block text-[10px] text-disabled">现价</span>
                  <span className={clsx('num mt-0.5 block', hasMarketPrice ? 'text-primary' : 'text-warning')}>
                    {hasMarketPrice ? formatNumber(position.marketPrice, 2) : '暂无行情'}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-disabled">成本价</span>
                  <span className="num mt-0.5 block text-primary">
                    {formatNumber(position.avgCostPerShareLocal, 2)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] text-disabled">预计年分红</span>
                  <span className={clsx('num mt-0.5 block', position.instrument.dividendEligible ? 'text-gold' : 'text-disabled')}>
                    {position.instrument.dividendEligible ? money(position.annualDividend, 0) : '—'}
                  </span>
                </div>
              </div>

              {!hasMarketPrice ? (
                <div className="mt-3 text-[11px] text-warning">该标的暂无有效行情，当前金额仅按买入成本暂估</div>
              ) : position.staleDays > 0 ? (
                <div className="mt-3 text-[11px] text-warning">
                  当前价格更新于 {position.staleDays} 天前
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

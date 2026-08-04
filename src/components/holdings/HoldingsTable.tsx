import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Position } from '@/types';
import { Table, TableColumn } from '@/components/ui/Table';
import { MarketBadge } from './MarketBadge';
import { HoldingsRowDetail } from './HoldingsRow';
import { Sparkline } from '@/components/charts/Sparkline';
import { Badge } from '@/components/ui/Badge';
import { useData } from '@/store/DataContext';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatNumber, formatPercent, formatPctPlain, formatQuantity, formatSigned } from '@/lib/format';
import clsx from 'clsx';

/** 14 列密集持仓表（32-36px 行高、可排序/隐藏列、行展开 TaxLot）PRD §8.4.2 */
export function HoldingsTable() {
  const navigate = useNavigate();
  const { state } = useData();
  const { positions } = usePortfolio();
  const { money, signed } = useMoneyFmt();

  const priceSeriesByInstrument = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const p of state.prices) {
      const list = map.get(p.instrumentId) ?? [];
      list.push(p.price);
      map.set(p.instrumentId, list);
    }
    for (const [k, v] of map) map.set(k, v.slice(-30));
    return map;
  }, [state.prices]);

  const columns = useMemo<TableColumn<Position>[]>(() => {
    const changeCell = (pos: Position) => {
      const pnlPct = pos.unrealizedPnlPct;
      const positive = pnlPct >= 0;
      return (
        <div className="flex flex-col items-end">
          <span className={clsx('num', positive ? 'text-up' : 'text-down')}>
            {signed(pos.unrealizedPnl, 0)}
          </span>
          <span className={clsx('num text-[11px]', positive ? 'text-up/80' : 'text-down/80')}>
            {formatPercent(pnlPct)}
          </span>
        </div>
      );
    };

    return [
      {
        key: 'symbol',
        title: '代码',
        align: 'left',
        width: '100px',
        sortValue: (p) => p.instrument.symbol,
        render: (p) => <span className="font-mono text-primary">{p.instrument.symbol}</span>,
      },
      {
        key: 'name',
        title: '名称',
        align: 'left',
        width: '140px',
        sortValue: (p) => p.instrument.name,
        render: (p) => (
          <span className="block max-w-[130px] truncate text-primary" title={p.instrument.name}>
            {p.instrument.name}
          </span>
        ),
      },
      {
        key: 'market',
        title: '市场',
        align: 'left',
        width: '76px',
        sortValue: (p) => p.instrument.market,
        render: (p) => <MarketBadge market={p.instrument.market} />,
      },
      {
        key: 'quantity',
        title: '数量',
        align: 'right',
        sortValue: (p) => p.totalQuantity,
        render: (p) => <span className="num">{formatQuantity(p.totalQuantity, p.instrument.market)}</span>,
      },
      {
        key: 'avgCost',
        title: '成本价',
        align: 'right',
        sortValue: (p) => p.avgCostPerShareLocal,
        render: (p) => <span className="num text-secondary">{formatNumber(p.avgCostPerShareLocal, 2)}</span>,
      },
      {
        key: 'price',
        title: '现价',
        align: 'right',
        sortValue: (p) => p.marketPrice,
        render: (p) => (
          <span className="num text-primary">
            {formatNumber(p.marketPrice, 2)}
            {p.staleDays > 0 && (
              <Badge variant="orange" className="ml-1" title={`最新价格 ${p.staleDays} 天前`}>
                ⚠{p.staleDays}天前
              </Badge>
            )}
          </span>
        ),
      },
      {
        key: 'sparkline',
        title: '30日',
        align: 'center',
        width: '90px',
        hideable: true,
        render: (p) => {
          const series = priceSeriesByInstrument.get(p.instrumentId) ?? [];
          if (series.length === 0) return <span className="text-disabled text-[11px]">—</span>;
          return <Sparkline data={series} positive={p.unrealizedPnl >= 0} height={26} />;
        },
      },
      {
        key: 'marketValue',
        title: '市值',
        align: 'right',
        sortValue: (p) => p.marketValue,
        render: (p) => (
          <span className="num text-primary">
            {money(p.marketValue, 0)}
            {p.instrument.market === 'FUND' && p.navDate && (
              <span className="block text-[10px] text-disabled">净值日 {p.navDate.slice(5)}</span>
            )}
          </span>
        ),
      },
      {
        key: 'pnl',
        title: '浮动盈亏',
        align: 'right',
        sortValue: (p) => p.unrealizedPnl,
        render: changeCell,
      },
      {
        key: 'weight',
        title: '占比',
        align: 'right',
        sortValue: (p) => p.weightPct,
        render: (p) => <span className="num text-secondary">{formatPctPlain(p.weightPct)}</span>,
      },
      {
        key: 'ttm',
        title: 'TTM股息',
        align: 'right',
        sortValue: (p) => p.ttmDividend,
        render: (p) => (
          <span className="num text-gold">{p.instrument.dividendEligible ? money(p.ttmDividend, 0) : '—'}</span>
        ),
      },
      {
        key: 'yield',
        title: '股息率',
        align: 'right',
        sortValue: (p) => p.dividendYield,
        render: (p) =>
          p.instrument.dividendEligible ? (
            <span className="num text-primary">{formatPctPlain(p.dividendYield)}</span>
          ) : (
            <span className="num text-disabled">—</span>
          ),
      },
      {
        key: 'yoc',
        title: 'YOC',
        align: 'right',
        sortValue: (p) => p.yoc,
        render: (p) =>
          p.instrument.dividendEligible ? (
            <span className="num text-gold">{formatPctPlain(p.yoc)}</span>
          ) : (
            <span className="num text-disabled">—</span>
          ),
      },
      {
        key: 'annual',
        title: '年化分红',
        align: 'right',
        sortValue: (p) => p.annualDividend,
        render: (p) => (
          <span className="num text-gold">
            {p.instrument.dividendEligible ? money(p.annualDividend, 0) : '—'}
          </span>
        ),
      },
    ];
  }, [money, priceSeriesByInstrument]);

  return (
    <Table
      columns={columns}
      rows={positions}
      rowKey={(p) => p.instrumentId}
      rowClassName={(p) => clsx(p.staleDays > 0 && 'opacity-90')}
      expandable={(p) => <HoldingsRowDetail position={p} />}
      defaultSortKey="marketValue"
      className="max-h-[calc(100vh-220px)]"
      dense
    />
  );
}

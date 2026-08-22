import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Gift,
  RefreshCw,
  WalletCards,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { useSettings } from '@/store/SettingsContext';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { addDays, todayISO } from '@/lib/clock';
import { formatPercent, formatQuantity } from '@/lib/format';
import type { DividendEvent, Position, PriceSnapshot, TodoItem } from '@/types';

const QUICK_ENTRY_EVENT = 'dividend-tracker:quick-entry';

function openQuickEntry() {
  window.dispatchEvent(new CustomEvent(QUICK_ENTRY_EVENT));
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
      <h2 className="text-[14px] font-semibold text-primary">{title}</h2>
      {action}
    </div>
  );
}

function EmptyLedger() {
  return (
    <section className="panel px-5 py-8 text-center sm:px-8 sm:py-10">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gold/10 text-gold">
        <BookOpen size={22} aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-primary">从第一笔持仓开始</h1>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-secondary">
        只需选择标的、填写数量和价格。之后的市值、收益与分红会自动整理。
      </p>
      <button
        type="button"
        onClick={openQuickEntry}
        className="mt-5 min-h-11 rounded-md bg-gold px-5 text-[13px] font-semibold text-page hover:bg-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
      >
        记第一笔
      </button>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="panel min-w-0 p-4">
      <div className="flex items-center gap-2 text-[11px] text-secondary">
        <Icon size={15} className="text-gold" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="num mt-2 truncate text-left text-[20px] font-semibold text-primary sm:text-[22px]">{value}</div>
      <p className="mt-1 truncate text-[10px] text-disabled">{hint}</p>
    </div>
  );
}

function PositionRow({
  position,
  hasMarketPrice,
  formatMoney,
}: {
  position: Position;
  hasMarketPrice: boolean;
  formatMoney: (amount: number, digits?: number) => string;
}) {
  const pnlClass = position.unrealizedPnl >= 0 ? 'text-up' : 'text-down';

  return (
    <Link
      to={`/instruments/${position.instrumentId}`}
      className="group flex min-h-[64px] items-center gap-3 border-t border-line-soft py-3 first:border-t-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/70"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-card-hover text-[11px] font-semibold text-secondary">
        {position.instrument.symbol.slice(0, 3).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-primary group-hover:text-gold">
          {position.instrument.name}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-disabled">
          {position.instrument.symbol} · {formatQuantity(position.totalQuantity, position.instrument.market)} 份
        </span>
      </span>
      <span className="shrink-0 text-right">
        {hasMarketPrice ? (
          <>
            <span className="num block text-[13px] text-primary">{formatMoney(position.marketValue, 0)}</span>
            <span className={`num mt-0.5 block text-[11px] ${pnlClass}`}>
              {formatPercent(position.unrealizedPnlPct)}
            </span>
          </>
        ) : (
          <>
            <span className="num block text-[13px] text-primary">{formatMoney(position.costValueCurrentFx, 0)}</span>
            <span className="mt-0.5 block text-[10px] text-warning">按成本暂估</span>
          </>
        )}
      </span>
    </Link>
  );
}

function dividendDate(event: DividendEvent): { date: string; label: string } | null {
  if (event.payDate) return { date: event.payDate, label: event.payDateEstimated ? '预计到账' : '到账' };
  if (event.exDate) return { date: event.exDate, label: '除息' };
  if (event.recordDate) return { date: event.recordDate, label: '登记' };
  return null;
}

function todoTarget(todo: TodoItem): string {
  return todo.kind === 'PENDING_TX' ? '/transactions' : '/settings';
}

function sameCurrencyMoney(symbol: string, amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return `${symbol}${Math.round(amount).toLocaleString('zh-CN')}`;
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

export function DashboardPage() {
  const portfolio = usePortfolio();
  const { settings } = useSettings();
  const { state, hydration, cloudSync, reloadMarketData } = useData();
  const { status: authStatus } = useAuth();
  const { fmt, symbol } = useMoneyFmt();
  const today = todayISO();
  const next90Days = addDays(today, 89);

  const hasLedger = state.transactions.some((item) => item.status !== 'VOIDED');
  const isStarting =
    !hasLedger &&
    (hydration.status === 'LOADING' || cloudSync === 'LOADING' || authStatus === 'CHECKING');

  const validQuoteIds = useMemo(() => latestValidQuoteIds(state.prices), [state.prices]);
  const missingPricePositions = useMemo(
    () => portfolio.positions.filter((position) => !validQuoteIds.has(position.instrumentId)),
    [portfolio.positions, validQuoteIds],
  );
  const pricedPositions = useMemo(
    () => portfolio.positions.filter((position) => validQuoteIds.has(position.instrumentId)),
    [portfolio.positions, validQuoteIds],
  );
  const hasCompleteValuation = portfolio.positions.length > 0 && missingPricePositions.length === 0;
  const hasPartialValuation = pricedPositions.length > 0 && missingPricePositions.length > 0;
  const isMarketUpdating = hydration.status === 'LOADING';
  const referenceTotal = useMemo(
    () =>
      portfolio.positions.reduce(
        (sum, position) =>
          sum +
          (validQuoteIds.has(position.instrumentId)
            ? position.marketValue
            : position.costValueCurrentFx),
        0,
      ),
    [portfolio.positions, validQuoteIds],
  );

  const dayChange = useMemo(
    () =>
      pricedPositions.reduce(
        (sum, position) =>
          sum + (position.marketPrice - position.prevPrice) * position.totalQuantity * position.fxRate,
        0,
      ),
    [pricedPositions],
  );

  const pricedMarketValue = useMemo(
    () => pricedPositions.reduce((sum, position) => sum + position.marketValue, 0),
    [pricedPositions],
  );
  const previousValue = pricedMarketValue - dayChange;
  const dayChangePct = previousValue > 0 ? dayChange / previousValue : 0;

  const allUpcoming = useMemo(
    () =>
      portfolio.enrichedDividends
        .map((event) => ({ event, timing: dividendDate(event) }))
        .filter(
          (item): item is { event: DividendEvent; timing: { date: string; label: string } } =>
            Boolean(
              item.timing &&
                item.timing.date >= today &&
                (item.event.status === 'DECLARED' || item.event.status === 'EX_DIVIDEND'),
            ),
        )
        .sort((left, right) => left.timing.date.localeCompare(right.timing.date)),
    [portfolio.enrichedDividends, today],
  );

  const upcoming = allUpcoming.slice(0, 5);

  const expected90Days = useMemo(
    () =>
      allUpcoming.reduce(
        (sum, item) => (item.timing.date <= next90Days ? sum + item.event.netAmount : sum),
        0,
      ),
    [allUpcoming, next90Days],
  );

  const instrumentsById = useMemo(
    () => new Map(state.instruments.map((instrument) => [instrument.id, instrument])),
    [state.instruments],
  );

  const largestPositions = useMemo(
    () => [...portfolio.positions].sort((a, b) => b.marketValue - a.marketValue).slice(0, 5),
    [portfolio.positions],
  );

  const missingPriceNames = useMemo(() => {
    const names = missingPricePositions.slice(0, 3).map((position) => position.instrument.symbol);
    const extra = missingPricePositions.length - names.length;
    return `${names.join('、')}${extra > 0 ? ` 等 ${missingPricePositions.length} 只` : ''}`;
  }, [missingPricePositions]);
  const staleQuotedCount = Math.max(0, portfolio.staleCount - missingPricePositions.length);

  if (isStarting) {
    return (
      <div className="mx-auto w-full max-w-[1280px] p-4 sm:p-5 lg:p-8">
        <div className="skeleton h-28 w-full rounded-xl" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="skeleton h-24" />
          <div className="skeleton h-24" />
          <div className="skeleton col-span-2 h-24 sm:col-span-1" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4 p-4 sm:p-5 lg:space-y-5 lg:p-8">
      {hydration.status === 'FAILED' && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/35 bg-warning/10 px-3.5 py-3 text-[12px] text-warning">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">行情暂未更新</div>
            <p className="mt-0.5 text-warning/80">已有账本仍可正常查看和记录。</p>
          </div>
          <button
            type="button"
            onClick={reloadMarketData}
            className="flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/60"
          >
            <RefreshCw size={13} aria-hidden="true" />
            重试
          </button>
        </div>
      )}

      {!settings.w8benFilled && portfolio.positions.some((position) => position.instrument.market === 'US') && (
        <Link
          to="/settings"
          className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[12px] text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/60"
        >
          <span>美股税务信息尚未确认，分红暂按保守税率估算</span>
          <ArrowRight size={15} className="shrink-0" aria-hidden="true" />
        </Link>
      )}

      {!hasLedger ? (
        <EmptyLedger />
      ) : (
        <>
          <section className="panel overflow-hidden px-4 py-5 sm:px-6 sm:py-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="text-[12px] text-secondary">
                  {hasCompleteValuation
                    ? '总资产'
                    : hasPartialValuation
                      ? '参考总额（含成本暂估）'
                      : isMarketUpdating
                        ? '行情更新中'
                        : '估值待更新'}
                </p>
                <div className="num mt-1.5 truncate text-left text-[34px] font-semibold tracking-[-0.035em] text-primary sm:text-[44px]">
                  {hasCompleteValuation
                    ? fmt(portfolio.totalMarketValue, 0)
                    : hasPartialValuation
                      ? fmt(referenceTotal, 0)
                      : '—'}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                  {pricedPositions.length > 0 ? (
                    <span className={dayChange >= 0 ? 'num text-up' : 'num text-down'}>
                      {hasPartialValuation ? '已报价部分今日 ' : '今日 '}
                      {`${dayChange >= 0 ? '+' : ''}${sameCurrencyMoney(symbol, dayChange)} · ${formatPercent(dayChangePct)}`}
                    </span>
                  ) : (
                    <span className="text-warning">{isMarketUpdating ? '正在获取行情' : '暂无有效行情'}</span>
                  )}
                  <span className="text-disabled">
                    持仓成本 {fmt(portfolio.totalCostValue, 0)}{!hasCompleteValuation ? '（非实时估值）' : ''}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <button
                  type="button"
                  onClick={openQuickEntry}
                  className="min-h-11 flex-1 rounded-md bg-gold px-4 text-[13px] font-semibold text-page hover:bg-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 sm:hidden"
                >
                  记一笔
                </button>
                <Link
                  to="/holdings"
                  className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-line px-4 text-[13px] font-medium text-secondary hover:border-gold/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 sm:flex-none"
                >
                  查看账本
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </section>

          {missingPricePositions.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3.5 py-3 text-[11px] leading-5 text-warning">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {missingPriceNames || '当前持仓'}暂无有效行情。
                {hasPartialValuation
                  ? '参考总额中，这些标的仅按买入成本暂估；其浮动盈亏暂不计算。'
                  : '在行情更新前不显示资产估值，持仓成本只作记账参考。'}
              </span>
            </div>
          )}

          <section aria-label="资产摘要" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SummaryCard
              icon={WalletCards}
              label="当前持仓"
              value={`${portfolio.positions.length} 只`}
              hint={`${state.transactions.filter((item) => item.status !== 'VOIDED').length} 笔记录`}
            />
            <SummaryCard
              icon={Gift}
              label="近 12 月分红"
              value={fmt(portfolio.ttmDividendTotal, 0)}
              hint="当前持仓已到账"
            />
            <div className="col-span-2 sm:col-span-1">
              <SummaryCard
                icon={CalendarDays}
                label="未来 90 天"
                value={fmt(expected90Days, 0)}
                hint={expected90Days > 0 ? '按已知日期预计' : '暂无已知到账'}
              />
            </div>
          </section>

          {staleQuotedCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-[11px] text-warning">
              <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
              <span>{staleQuotedCount} 只持仓的行情较旧，金额可能不是最新。</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] lg:gap-5">
            <section className="panel p-4 sm:p-5">
              <SectionHeader
                title="持仓概览"
                action={
                  <Link to="/holdings" className="flex items-center gap-1 text-[11px] text-secondary hover:text-gold">
                    全部 <ArrowRight size={13} aria-hidden="true" />
                  </Link>
                }
              />
              {largestPositions.length > 0 ? (
                <div>
                  {largestPositions.map((position) => (
                    <PositionRow
                      key={position.instrumentId}
                      position={position}
                      hasMarketPrice={validQuoteIds.has(position.instrumentId)}
                      formatMoney={fmt}
                    />
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-[12px] text-secondary">暂无当前持仓</p>
              )}
            </section>

            <section className="panel p-4 sm:p-5">
              <SectionHeader
                title="近期分红"
                action={
                  <Link to="/calendar" className="flex items-center gap-1 text-[11px] text-secondary hover:text-gold">
                    日历 <ArrowRight size={13} aria-hidden="true" />
                  </Link>
                }
              />
              {upcoming.length > 0 ? (
                <div>
                  {upcoming.map(({ event, timing }) => {
                    const instrument = instrumentsById.get(event.instrumentId);
                    return (
                      <div key={event.id} className="flex min-h-[58px] items-center gap-3 border-t border-line-soft py-3 first:border-t-0">
                        <div className="w-[46px] shrink-0 text-center">
                          <div className="num text-[12px] font-semibold text-primary">{timing.date.slice(5)}</div>
                          <div className="mt-0.5 text-[9px] text-disabled">{timing.label}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-medium text-primary">
                            {instrument?.name ?? event.instrumentId}
                          </div>
                          <div className="mt-0.5 truncate text-[10px] text-disabled">
                            {instrument?.symbol ?? event.instrumentId}
                            {event.isEstimate ? ' · 预测' : ''}
                          </div>
                        </div>
                        <div className="num shrink-0 text-[12px] font-semibold text-gold">{fmt(event.netAmount, 0)}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-[160px] flex-col items-center justify-center text-center">
                  <CalendarDays size={22} className="text-disabled" aria-hidden="true" />
                  <p className="mt-2 text-[12px] text-secondary">暂无已知的近期分红</p>
                  <p className="mt-1 text-[10px] text-disabled">公告日期出现后会显示在这里</p>
                </div>
              )}
            </section>
          </div>

          <section className="panel p-4 sm:p-5">
            <SectionHeader
              title="需要留意"
              action={
                portfolio.todos.length > 0 ? (
                  <Link to="/notifications" className="flex items-center gap-1 text-[11px] text-secondary hover:text-gold">
                    查看全部 <ArrowRight size={13} aria-hidden="true" />
                  </Link>
                ) : undefined
              }
            />
            {portfolio.todos.length === 0 ? (
              <div className="flex min-h-[72px] items-center gap-3 rounded-md bg-card-hover/50 px-3.5 text-[12px] text-secondary">
                <CheckCircle2 size={18} className="shrink-0 text-healthy" aria-hidden="true" />
                暂无待办，账本状态正常
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {portfolio.todos.slice(0, 4).map((todo) => (
                  <Link
                    key={todo.id}
                    to={todoTarget(todo)}
                    className="flex min-h-[60px] items-start gap-3 rounded-md bg-card-hover/55 px-3.5 py-3 hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
                  >
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        todo.severity === 'ERROR' ? 'bg-danger' : todo.severity === 'WARN' ? 'bg-warning' : 'bg-declared'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-primary">{todo.title}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-secondary">{todo.detail}</span>
                    </span>
                    <ArrowRight size={14} className="mt-0.5 shrink-0 text-disabled" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

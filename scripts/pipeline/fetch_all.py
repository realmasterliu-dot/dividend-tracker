#!/usr/bin/env python3
"""分红追踪数据管道主编排器。

用法示例
--------
    python fetch_all.py                          # 全量抓取（增量窗口）
    python fetch_all.py --only prices            # 只抓行情
    python fetch_all.py --only dividends,fx      # 抓指定类别
    python fetch_all.py --probe                  # 连通性探测，不写数据
    python fetch_all.py --instruments 600519.SH,AAPL
    python fetch_all.py --backfill --verbose     # 强制全历史回填

设计原则
--------
- **永不崩溃**：任何单个数据源失败都降级为 warning 并继续，最终汇总到
  meta.json 的 warnings 数组。只有"完全没产出任何数据"才返回非零退出码。
- **幂等可重入**：同一天重复运行不会产生重复数据；价格按
  (instrumentId, date) 去重，分红按 sourceKey 去重。
- **增量优先**：历史数据落在 cache/ 并提交进仓库，日常只拉最近 N 天。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Sequence

# 让 `python scripts/pipeline/fetch_all.py` 与 `cd scripts/pipeline && python fetch_all.py`
# 两种调用方式都能正确解析 config/models/providers
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("TQDM_DISABLE", "1")

from config import (  # noqa: E402
    BASE_CURRENCY,
    CACHE_DIR,
    COLD_START_DATE,
    DEFAULT_LOOKBACK_DAYS,
    DIVIDEND_CACHE_DIR,
    DIVIDEND_CACHE_SCHEMA,
    FX_CACHE_FILE,
    INSTRUMENTS,
    OUTPUT_DIR,
    PIPELINE_VERSION,
    PRICE_CACHE_DIR,
    VALID_CATEGORIES,
    InstrumentConfig,
)
from models import (  # noqa: E402
    DividendEvent,
    FxSnapshot,
    PipelineMeta,
    PriceSnapshot,
)
from providers.base import (  # noqa: E402
    LOG,
    ChainResult,
    HealthRegistry,
    ResilientFetcher,
    now_iso,
    setup_logging,
    today,
)
from providers.cn_stock import CnStockProvider  # noqa: E402
from providers.crypto import CryptoProvider  # noqa: E402
from providers.fund import FundProvider  # noqa: E402
from providers.fx import FxProvider, FxResolver  # noqa: E402
from providers.gold import GoldProvider  # noqa: E402
from providers.hk_stock import HkStockProvider  # noqa: E402
from providers.us_stock import UsStockProvider  # noqa: E402
from quality_gate import QualityGate  # noqa: E402


# ==================================================================== JSON I/O
def read_json(path: Path, default: Any) -> Any:
    """读取 JSON 文件，失败时返回默认值。

    Args:
        path: 文件路径。
        default: 读取失败时的兜底值。

    Returns:
        解析结果或默认值。
    """
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        LOG.warning("读取 %s 失败（已忽略）: %s", path.name, exc)
        return default


def write_json(path: Path, payload: Any) -> None:
    """原子化写入 JSON（先写临时文件再替换）。

    避免管道在写入途中被中断时留下半截文件，导致前端解析崩溃。

    Args:
        path: 目标路径。
        payload: 可序列化对象。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    temp_path.replace(path)


# ======================================================== 分红缓存（带 schema 版本）
def load_dividend_cache(path: Path) -> dict[str, DividendEvent]:
    """读取分红缓存，并在 schema 版本不一致时安全重建。

    分红缓存按 sourceKey 累积且只增不删（这样数据源临时降级少返记录时不会丢
    历史）。副作用是 sourceKey 规则一旦变化，旧键不会被清理，同一笔分红会以
    新旧两个键并存。这里通过 schema 版本号显式解决：版本不匹配时丢弃管道抓取
    的条目、只保留用户手工录入的条目，让本轮抓取按新规则重建。

    兼容两种磁盘格式：
      - 新格式：{"schemaVersion": int, "events": [...]}
      - 旧格式：[...]（裸数组，视为 schemaVersion=1）

    Args:
        path: 缓存文件路径。

    Returns:
        sourceKey -> DividendEvent 的字典。
    """
    raw = read_json(path, None)
    if raw is None:
        return {}

    if isinstance(raw, dict):
        schema = raw.get("schemaVersion", 1)
        rows = raw.get("events", [])
    elif isinstance(raw, list):
        # 旧的裸数组格式
        schema = 1
        rows = raw
    else:
        LOG.warning("分红缓存 %s 格式无法识别，已忽略", path.name)
        return {}

    if not isinstance(rows, list):
        return {}

    cached: dict[str, DividendEvent] = {}
    for item in rows:
        try:
            event = DividendEvent.from_dict(item)
        except (AttributeError, KeyError, TypeError, ValueError):
            continue
        if event.source_key:
            cached[event.source_key] = event

    if schema != DIVIDEND_CACHE_SCHEMA:
        kept = {k: v for k, v in cached.items() if v.manual}
        LOG.warning(
            "分红缓存 %s 的 schema 版本为 %s（当前 %s），已重建："
            "丢弃 %d 条管道条目，保留 %d 条手工条目",
            path.name,
            schema,
            DIVIDEND_CACHE_SCHEMA,
            len(cached) - len(kept),
            len(kept),
        )
        return kept

    return cached


def save_dividend_cache(path: Path, cached: dict[str, DividendEvent]) -> None:
    """按当前 schema 版本写回分红缓存。

    Args:
        path: 缓存文件路径。
        cached: sourceKey -> DividendEvent 的字典。
    """
    payload = {
        "schemaVersion": DIVIDEND_CACHE_SCHEMA,
        "events": [event.to_dict() for event in cached.values()],
    }
    write_json(path, payload)


# ==================================================================== 管道
class Pipeline:
    """数据管道编排器。"""

    def __init__(
        self,
        instruments: Sequence[InstrumentConfig],
        categories: Sequence[str],
        lookback_days: int = DEFAULT_LOOKBACK_DAYS,
        force_backfill: bool = False,
        output_dir: Path = OUTPUT_DIR,
    ) -> None:
        """初始化管道。

        Args:
            instruments: 本轮要处理的标的。
            categories: 要抓取的类别（prices/dividends/fx）。
            lookback_days: 增量窗口天数。
            force_backfill: 是否忽略缓存强制全历史回填。
            output_dir: JSON 输出目录。
        """
        self.instruments = list(instruments)
        self.categories = list(categories)
        self.lookback_days = lookback_days
        self.force_backfill = force_backfill
        self.output_dir = output_dir

        self.health = HealthRegistry()
        self.fetcher = ResilientFetcher(self.health)
        self.gate = QualityGate()
        self.warnings: list[str] = []
        self.fx_resolver: FxResolver | None = None

        self.fx_provider = FxProvider(self.fetcher)
        self._providers = {
            "A_SHARE": CnStockProvider(self.fetcher),
            "HK": HkStockProvider(self.fetcher),
            "US": UsStockProvider(self.fetcher),
            "FUND": FundProvider(self.fetcher),
            "CRYPTO": CryptoProvider(self.fetcher),
            # 黄金备源需要实时汇率把 XAU(USD/oz) 折成 CNY/克
            "GOLD": GoldProvider(self.fetcher, usd_cny_getter=self._usd_cny),
        }

    # ------------------------------------------------------------ 辅助
    def _usd_cny(self) -> float | None:
        """供黄金 provider 回调获取当前 USD/CNY 汇率。"""
        if self.fx_resolver is None:
            return None
        return self.fx_resolver.latest_rate("USDCNY")

    def provider_for(self, instrument: InstrumentConfig):
        """按市场取得对应 provider。

        Args:
            instrument: 标的配置。

        Returns:
            provider 实例。
        """
        return self._providers[instrument.market]

    def _window(self, cached_dates: Iterable[str]) -> tuple[str, str]:
        """计算本次抓取窗口。

        冷启动（缓存为空）时回填到 `COLD_START_DATE`，
        日常运行只拉最近 `lookback_days` 天。

        Args:
            cached_dates: 缓存中已有的日期。

        Returns:
            (start, end) ISO 日期二元组。
        """
        end = today().strftime("%Y-%m-%d")
        dates = list(cached_dates)
        if self.force_backfill or not dates:
            return COLD_START_DATE, end
        start = (today() - timedelta(days=self.lookback_days)).strftime("%Y-%m-%d")
        return start, end

    def _warn(self, message: str) -> None:
        """记录一条警告（同时写日志与 meta.warnings）。

        Args:
            message: 警告文案。
        """
        self.warnings.append(message)
        LOG.warning(message)

    # ------------------------------------------------------------ 汇率
    def run_fx(self) -> list[FxSnapshot]:
        """抓取并合并汇率，构建 FxResolver。

        即使本轮不抓 fx，也会加载缓存以便给行情回填 fxRate。

        Returns:
            合并后的全量 FxSnapshot 列表。
        """
        cached_raw = read_json(FX_CACHE_FILE, [])
        merged: dict[str, FxSnapshot] = {}
        for raw in cached_raw:
            try:
                snapshot = FxSnapshot.from_dict(raw)
                merged[snapshot.date] = snapshot
            except (KeyError, TypeError, ValueError):
                continue

        if "fx" in self.categories:
            start, end = self._window(merged.keys())
            LOG.info("抓取汇率 %s → %s", start, end)
            result = self.fx_provider.fetch(start, end)
            if result.ok and result.value:
                gated = self.gate.filter_fx(result.value)
                self.warnings.extend(gated.warnings)
                for snapshot in gated.accepted:
                    merged[snapshot.date] = snapshot
                LOG.info(
                    "汇率入库 %d 条（源：%s）", len(gated.accepted), result.source_used
                )
            else:
                self._warn(f"汇率全部源失败，沿用缓存 {len(merged)} 条：{result.error_summary}")

        snapshots = sorted(merged.values(), key=lambda s: s.date)
        self.fx_resolver = FxResolver(snapshots)
        if not snapshots:
            self._warn("无任何汇率数据，非本位币标的的 fxRate 将退化为 1.0")
        return snapshots

    # ------------------------------------------------------------ 行情
    def run_prices(self) -> list[PriceSnapshot]:
        """抓取全部标的行情并与缓存合并。

        Returns:
            合并后的全量 PriceSnapshot 列表。
        """
        all_prices: list[PriceSnapshot] = []

        for instrument in self.instruments:
            cache_path = PRICE_CACHE_DIR / f"{instrument.id}.json"
            cached: dict[tuple[str, str], PriceSnapshot] = {}
            for raw in read_json(cache_path, []):
                try:
                    snapshot = PriceSnapshot.from_dict(raw)
                    cached[snapshot.key] = snapshot
                except (KeyError, TypeError, ValueError):
                    continue

            if "prices" in self.categories:
                start, end = self._window(date for _, date in cached)
                LOG.info(
                    "抓取行情 %s (%s) %s → %s",
                    instrument.id,
                    instrument.market,
                    start,
                    end,
                )
                result = self.provider_for(instrument).fetch_prices(
                    instrument, start, end
                )
                self._absorb_prices(instrument, result, cached)
                # 缓存立即落盘：即使后续标的抓取出错，本标的成果也不会丢
                write_json(
                    cache_path,
                    [s.to_dict() for s in sorted(cached.values(), key=lambda x: x.date)],
                )

            all_prices.extend(cached.values())

        self._apply_fx_rates(all_prices)
        return sorted(all_prices, key=lambda s: (s.instrument_id, s.date))

    def _absorb_prices(
        self,
        instrument: InstrumentConfig,
        result: ChainResult[list[PriceSnapshot]],
        cached: dict[tuple[str, str], PriceSnapshot],
    ) -> None:
        """把一次抓取结果过闸门后合并进缓存字典。

        Args:
            instrument: 标的配置。
            result: 抓取结果。
            cached: 就地更新的缓存字典。
        """
        if not result.ok:
            self._warn(
                f"[{instrument.id}] 行情抓取失败，沿用缓存 {len(cached)} 条："
                f"{result.error_summary}"
            )
            return
        if not result.value:
            LOG.info("[%s] 本窗口无新增行情", instrument.id)
            return

        known = {date: snapshot.price for (_, date), snapshot in cached.items()}
        gated = self.gate.filter_prices(
            result.value, known, instrument.market, instrument.id
        )
        self.warnings.extend(gated.warnings)

        for snapshot in gated.accepted:
            cached[snapshot.key] = snapshot

        LOG.info(
            "[%s] 接受 %d 条 / 拒绝 %d / 存疑 %d（源：%s）",
            instrument.id,
            len(gated.accepted),
            gated.rejected_count,
            gated.suspect_count,
            result.source_used,
        )

    def _apply_fx_rates(self, snapshots: Sequence[PriceSnapshot]) -> None:
        """为每条行情回填当日 `标的币种 → 本位币` 汇率。

        Args:
            snapshots: 待回填的快照（就地修改）。
        """
        if self.fx_resolver is None:
            return
        for snapshot in snapshots:
            snapshot.fx_rate = self.fx_resolver.rate(
                snapshot.currency, snapshot.date, BASE_CURRENCY
            )

    # ------------------------------------------------------------ 分红
    def run_dividends(self) -> list[DividendEvent]:
        """抓取全部标的分红并与缓存合并（按 sourceKey 去重）。

        Returns:
            合并后的全量 DividendEvent 列表。
        """
        all_events: list[DividendEvent] = []

        for instrument in self.instruments:
            cache_path = DIVIDEND_CACHE_DIR / f"{instrument.id}.json"
            cached: dict[str, DividendEvent] = load_dividend_cache(cache_path)

            if "dividends" in self.categories:
                if not instrument.dividend_eligible:
                    LOG.debug("[%s] 无分红属性，跳过", instrument.id)
                else:
                    LOG.info("抓取分红 %s (%s)", instrument.id, instrument.market)
                    result = self.provider_for(instrument).fetch_dividends(instrument)
                    self._absorb_dividends(instrument, result, cached)
                    save_dividend_cache(cache_path, cached)

            all_events.extend(cached.values())

        return sorted(
            all_events,
            key=lambda e: (
                e.instrument_id,
                e.ex_date or e.pay_date or e.announce_date or "",
            ),
        )

    def _absorb_dividends(
        self,
        instrument: InstrumentConfig,
        result: ChainResult[list[DividendEvent]],
        cached: dict[str, DividendEvent],
    ) -> None:
        """把分红抓取结果过闸门后合并进缓存字典。

        Args:
            instrument: 标的配置。
            result: 抓取结果。
            cached: 就地更新的缓存字典。
        """
        if not result.ok:
            self._warn(
                f"[{instrument.id}] 分红抓取失败，沿用缓存 {len(cached)} 条："
                f"{result.error_summary}"
            )
            return
        if not result.value:
            LOG.info("[%s] 该标的无分红记录", instrument.id)
            return

        gated = self.gate.filter_dividends(result.value, instrument.id)
        self.warnings.extend(gated.warnings)

        for event in gated.accepted:
            existing = cached.get(event.source_key)
            # 用户手工录入的事件优先级最高，管道不得覆盖
            if existing is not None and existing.manual:
                continue
            cached[event.source_key] = event

        LOG.info(
            "[%s] 分红接受 %d 条 / 拒绝 %d（源：%s）",
            instrument.id,
            len(gated.accepted),
            gated.rejected_count,
            result.source_used,
        )

    # ------------------------------------------------------------ 探测
    def run_probe(self) -> int:
        """连通性探测模式：逐个测试所有源，不写任何数据文件。

        用于在 GitHub Actions 境外 runner 上实测各源真实可用性
        （尤其是境内被墙的加密源在 Actions 上是否能通）。

        Returns:
            进程退出码（恒为 0，探测不代表失败）。
        """
        print("\n" + "=" * 78)
        print("连通性探测（--probe）：只测试，不写数据")
        print("=" * 78)

        start = (today() - timedelta(days=7)).strftime("%Y-%m-%d")
        end = today().strftime("%Y-%m-%d")
        rows: list[tuple[str, str, str, str]] = []

        if "fx" in self.categories:
            for attempt in self.fetcher.probe("fx", self.fx_provider.candidates(start, end)):
                rows.append(_probe_row("fx", attempt))

        # 黄金 XAU 备源依赖 USD/CNY 汇率才能换算单位。探测模式下先在内存里
        # 取一次汇率（不落盘），否则该源会因缺汇率而误报为"不可用"。
        if self.fx_resolver is None:
            fx_result = self.fx_provider.fetch(start, end)
            if fx_result.ok and fx_result.value:
                self.fx_resolver = FxResolver(fx_result.value)

        for instrument in self.instruments:
            provider = self.provider_for(instrument)
            if "prices" in self.categories:
                for attempt in self.fetcher.probe(
                    f"prices:{instrument.id}",
                    provider.price_candidates(instrument, start, end),
                ):
                    rows.append(_probe_row(f"{instrument.id}·行情", attempt))
            if "dividends" in self.categories and instrument.dividend_eligible:
                for attempt in self.fetcher.probe(
                    f"dividends:{instrument.id}",
                    provider.dividend_candidates(instrument),
                ):
                    rows.append(_probe_row(f"{instrument.id}·分红", attempt))

        print("\n{:<20} {:<40} {:>8}  {}".format("类别", "数据源", "耗时", "结果"))
        print("-" * 78)
        for category, source, elapsed, outcome in rows:
            print(f"{category:<20} {source:<40} {elapsed:>8}  {outcome}")

        ok_count = sum(1 for r in rows if r[3].startswith("OK"))
        print("-" * 78)
        print(f"合计 {len(rows)} 个源，可用 {ok_count}，不可用 {len(rows) - ok_count}\n")
        return 0

    # ------------------------------------------------------------ 主流程
    def run(self) -> int:
        """执行完整管道。

        Returns:
            进程退出码：0 成功，1 表示完全没有产出任何数据。
        """
        started = time.perf_counter()
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

        # 汇率必须最先跑：行情要用它回填 fxRate，黄金备源要用它换算单位
        fx_snapshots = self.run_fx()
        prices = self.run_prices()
        dividends = self.run_dividends()

        # 落盘缓存与健康度
        write_json(FX_CACHE_FILE, [s.to_dict() for s in fx_snapshots])
        self.health.save()

        degraded = self.health.degraded_sources()
        if degraded:
            self._warn(f"以下数据源已连续失败并进入熔断：{', '.join(degraded)}")

        # 输出五个契约文件
        self.output_dir.mkdir(parents=True, exist_ok=True)
        write_json(self.output_dir / "prices.json", [s.to_dict() for s in prices])
        write_json(
            self.output_dir / "dividends.json", [e.to_dict() for e in dividends]
        )
        write_json(self.output_dir / "fx.json", [s.to_dict() for s in fx_snapshots])
        write_json(self.output_dir / "source_health.json", self.health.to_contract())

        duration = time.perf_counter() - started
        meta = PipelineMeta(
            generated_at=now_iso(),
            pipeline_version=PIPELINE_VERSION,
            instrument_count=len(self.instruments),
            warnings=self.warnings,
            duration_seconds=duration,
            categories=self.categories,
        )
        write_json(self.output_dir / "meta.json", meta.to_dict())

        self._print_summary(prices, dividends, fx_snapshots, duration)
        if not prices and not dividends and not fx_snapshots:
            LOG.error("本轮没有产出任何数据")
            return 1
        return 0

    def _print_summary(
        self,
        prices: Sequence[PriceSnapshot],
        dividends: Sequence[DividendEvent],
        fx_snapshots: Sequence[FxSnapshot],
        duration: float,
    ) -> None:
        """打印运行摘要。

        注意：只输出行情/分红的**条数与日期**，不打印任何持仓金额或资产总额。

        Args:
            prices: 全量行情。
            dividends: 全量分红。
            fx_snapshots: 全量汇率。
            duration: 总耗时秒数。
        """
        print("\n" + "=" * 78)
        print(f"管道完成 · 耗时 {duration:.1f}s · 版本 {PIPELINE_VERSION}")
        print("=" * 78)
        print(f"  prices.json     {len(prices):>6} 条")
        print(f"  dividends.json  {len(dividends):>6} 条")
        print(f"  fx.json         {len(fx_snapshots):>6} 条")
        print(f"  warnings        {len(self.warnings):>6} 条")

        by_instrument: dict[str, int] = {}
        latest: dict[str, str] = {}
        for snapshot in prices:
            by_instrument[snapshot.instrument_id] = (
                by_instrument.get(snapshot.instrument_id, 0) + 1
            )
            if snapshot.date > latest.get(snapshot.instrument_id, ""):
                latest[snapshot.instrument_id] = snapshot.date

        print("\n  标的            行情条数   最新日期")
        for instrument in self.instruments:
            count = by_instrument.get(instrument.id, 0)
            print(
                f"  {instrument.id:<14} {count:>8}   "
                f"{latest.get(instrument.id, '—')}"
            )

        if self.warnings:
            print(f"\n  警告（前 10 条，完整列表见 meta.json）：")
            for message in self.warnings[:10]:
                print(f"    - {message}")
        print()


def _probe_row(category: str, attempt: Any) -> tuple[str, str, str, str]:
    """把一条探测记录格式化成表格行。

    Args:
        category: 类别标签。
        attempt: SourceAttempt。

    Returns:
        四元组 (类别, 源名, 耗时, 结果)。
    """
    outcome = "OK" if attempt.ok else f"FAIL  {attempt.error[:60]}"
    if attempt.ok:
        outcome = f"OK    rows={attempt.rows}"
    return category, attempt.source, f"{attempt.elapsed_s:.2f}s", outcome


# ==================================================================== CLI
def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """解析命令行参数。

    Args:
        argv: 参数列表，None 表示取 `sys.argv`。

    Returns:
        解析结果。
    """
    parser = argparse.ArgumentParser(
        prog="fetch_all.py",
        description="分红追踪数据管道：抓取行情/分红/汇率并输出前端契约 JSON。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例：\n"
            "  python fetch_all.py\n"
            "  python fetch_all.py --only prices\n"
            "  python fetch_all.py --only dividends,fx\n"
            "  python fetch_all.py --probe\n"
            "  python fetch_all.py --instruments 600519.SH,AAPL --verbose\n"
        ),
    )
    parser.add_argument(
        "--only",
        default=",".join(VALID_CATEGORIES),
        help="只抓指定类别，逗号分隔：prices,dividends,fx（默认全部）",
    )
    parser.add_argument(
        "--instruments",
        default="",
        help="只处理指定标的，逗号分隔（默认全部 7 个种子标的）",
    )
    parser.add_argument(
        "--probe",
        action="store_true",
        help="连通性探测模式：逐个测试所有数据源但不写任何文件",
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help=f"忽略缓存，从 {COLD_START_DATE} 起全量回填历史",
    )
    parser.add_argument(
        "--lookback",
        type=int,
        default=DEFAULT_LOOKBACK_DAYS,
        help=f"增量窗口天数（默认 {DEFAULT_LOOKBACK_DAYS}）",
    )
    parser.add_argument(
        "--output-dir",
        default=str(OUTPUT_DIR),
        help=f"JSON 输出目录（默认 {OUTPUT_DIR}）",
    )
    parser.add_argument("--verbose", action="store_true", help="输出 DEBUG 级别日志")
    return parser.parse_args(argv)


def resolve_categories(raw: str) -> list[str]:
    """解析并校验 --only 参数。

    Args:
        raw: 逗号分隔的类别串。

    Returns:
        合法类别列表。

    Raises:
        SystemExit: 含非法类别时退出。
    """
    categories = [c.strip().lower() for c in raw.split(",") if c.strip()]
    invalid = [c for c in categories if c not in VALID_CATEGORIES]
    if invalid:
        raise SystemExit(
            f"非法类别 {invalid}，可选：{', '.join(VALID_CATEGORIES)}"
        )
    return categories or list(VALID_CATEGORIES)


def resolve_instruments(raw: str) -> list[InstrumentConfig]:
    """解析并校验 --instruments 参数。

    Args:
        raw: 逗号分隔的标的 ID 串。

    Returns:
        标的配置列表。

    Raises:
        SystemExit: 含未知标的时退出。
    """
    if not raw.strip():
        return list(INSTRUMENTS)
    wanted = [i.strip() for i in raw.split(",") if i.strip()]
    known = {i.id: i for i in INSTRUMENTS}
    invalid = [i for i in wanted if i not in known]
    if invalid:
        raise SystemExit(
            f"未知标的 {invalid}，可选：{', '.join(known)}"
        )
    return [known[i] for i in wanted]


def main(argv: Sequence[str] | None = None) -> int:
    """CLI 入口。

    Args:
        argv: 参数列表。

    Returns:
        进程退出码。
    """
    args = parse_args(argv)
    setup_logging(args.verbose)

    categories = resolve_categories(args.only)
    instruments = resolve_instruments(args.instruments)

    LOG.info(
        "管道启动 v%s | 类别=%s | 标的=%d 个 | 回填=%s",
        PIPELINE_VERSION,
        ",".join(categories),
        len(instruments),
        args.backfill,
    )

    pipeline = Pipeline(
        instruments=instruments,
        categories=categories,
        lookback_days=args.lookback,
        force_backfill=args.backfill,
        output_dir=Path(args.output_dir),
    )

    if args.probe:
        return pipeline.run_probe()
    return pipeline.run()


if __name__ == "__main__":
    sys.exit(main())

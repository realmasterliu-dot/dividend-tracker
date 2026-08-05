"""A 股 provider：东财行情 + 分红送配。

实测结论（akshare 1.18.22）
--------------------------
- `stock_zh_a_hist`：0.11s / 26 行，稳定。
- `stock_fhps_detail_em`：0.39s，**按标的**返回全部历史分红，列齐全
  （含 方案进度 / 股权登记日 / 除权除息日），是首选。
- `stock_fhps_em`：2.8s，**按报告期**返回全市场。注意其列集合随报告期变化：
  `date='20241231'` 有 方案进度/股权登记日，而 `date='20251231'` 没有。
  因此只作降级备源，并对列做存在性检查。
- 严禁使用 `stock_zh_a_spot_em`（全市场 5889 行 / 82s）。
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from typing import Any

os.environ.setdefault("TQDM_DISABLE", "1")

import akshare as ak
import pandas as pd

from config import (
    A_SHARE_DIVIDEND_PER_SHARES,
    A_SHARE_PROGRESS_MAP,
    A_SHARE_SKIP_KEYWORDS,
    InstrumentConfig,
)
from models import DividendEvent, PriceSnapshot
from providers.base import (
    BaseProvider,
    SourceCandidate,
    compact_date,
    safe_float,
    to_iso_date,
    today,
)


class CnStockProvider(BaseProvider):
    """A 股行情与分红。"""

    name = "cn_stock"

    # ------------------------------------------------------------ 行情
    def price_candidates(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[SourceCandidate[list[PriceSnapshot]]]:
        """构建 A 股行情降级链。

        Args:
            instrument: 标的配置。
            start: 起始日期 `yyyy-mm-dd`。
            end: 结束日期 `yyyy-mm-dd`。

        Returns:
            候选源列表。
        """
        return [
            SourceCandidate(
                name="akshare.stock_zh_a_hist",
                label="akshare·东财A股",
                fn=lambda: self._hist(instrument, start, end),
            )
        ]

    def _hist(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[PriceSnapshot]:
        """拉取单只 A 股的前复权日线。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            PriceSnapshot 列表。
        """
        frame = ak.stock_zh_a_hist(
            symbol=instrument.fetch_symbol,
            period="daily",
            start_date=compact_date(start),
            end_date=compact_date(end),
            adjust="qfq",
        )
        return _frame_to_prices(frame, instrument, "akshare·东财A股")

    # ------------------------------------------------------------ 分红
    def dividend_candidates(
        self, instrument: InstrumentConfig
    ) -> list[SourceCandidate[list[DividendEvent]]]:
        """构建 A 股分红降级链。

        Args:
            instrument: 标的配置。

        Returns:
            候选源列表（首选按标的查，备源按报告期全市场筛选）。
        """
        return [
            SourceCandidate(
                name="akshare.stock_fhps_detail_em",
                label="akshare·东财分红明细",
                fn=lambda: self._dividends_detail(instrument),
            ),
            SourceCandidate(
                name="akshare.stock_fhps_em",
                label="akshare·东财分红送配",
                fn=lambda: self._dividends_by_period(instrument),
            ),
        ]

    def _dividends_detail(self, instrument: InstrumentConfig) -> list[DividendEvent]:
        """首选源：按标的拉全部历史分红方案。

        Args:
            instrument: 标的配置。

        Returns:
            DividendEvent 列表。
        """
        frame = ak.stock_fhps_detail_em(symbol=instrument.fetch_symbol)
        return self._parse_fhps_frame(frame, instrument, "em:fhps")

    def _dividends_by_period(self, instrument: InstrumentConfig) -> list[DividendEvent]:
        """备源：按报告期拉全市场再筛出本标的。

        仅在首选源失败时调用。只取最近两个年报期以控制耗时（每次约 2.8s）。

        Args:
            instrument: 标的配置。

        Returns:
            DividendEvent 列表。
        """
        events: list[DividendEvent] = []
        current_year = today().year
        # 年报期是分红信息最完整的报告期
        periods = [f"{year}1231" for year in (current_year - 1, current_year - 2)]
        for period in periods:
            try:
                frame = ak.stock_fhps_em(date=period)
            except Exception:  # noqa: BLE001 — 单个报告期失败不影响其他期
                continue
            if frame is None or frame.empty or "代码" not in frame.columns:
                continue
            matched = frame[frame["代码"].astype(str) == instrument.fetch_symbol]
            if matched.empty:
                continue
            # 该接口无「报告期」列，用查询参数补上，保证 sourceKey 稳定
            matched = matched.copy()
            matched["报告期"] = f"{period[:4]}-{period[4:6]}-{period[6:]}"
            events.extend(self._parse_fhps_frame(matched, instrument, "em:fhps"))
        return events

    def _parse_fhps_frame(
        self, frame: pd.DataFrame, instrument: InstrumentConfig, key_prefix: str
    ) -> list[DividendEvent]:
        """把东财分红送配表解析成 DividendEvent 列表。

        兼容两个接口的列集合差异：`stock_fhps_em` 在部分报告期缺少
        方案进度/股权登记日/除权除息日，此处全部做存在性检查。

        Args:
            frame: 东财返回的原始 DataFrame。
            instrument: 标的配置。
            key_prefix: sourceKey 前缀。

        Returns:
            DividendEvent 列表。
        """
        if frame is None or frame.empty:
            return []

        events: list[DividendEvent] = []
        columns = set(frame.columns)

        for _, row in frame.iterrows():
            progress = str(row.get("方案进度", "") or "").strip()
            description = str(row.get("现金分红-现金分红比例描述", "") or "")

            # 不分配/终止分配直接跳过
            haystack = f"{progress}{description}"
            if any(keyword in haystack for keyword in A_SHARE_SKIP_KEYWORDS):
                continue

            # 每 10 股派息 → 每股金额
            cash_per_10 = safe_float(row.get("现金分红-现金分红比例"))
            per_share = (
                cash_per_10 / A_SHARE_DIVIDEND_PER_SHARES if cash_per_10 else 0.0
            )
            scrip_per_10 = safe_float(row.get("送转股份-送转总比例")) or 0.0

            # 预披露阶段常见：只有一句"分红金额上限不超过…"，无具体金额。
            # 此时无法产出有意义的 perShareAmount，跳过（下次公布方案后自然补上）。
            if per_share <= 0 and scrip_per_10 <= 0:
                continue

            period = to_iso_date(row.get("报告期")) or ""
            announce = to_iso_date(row.get("预案公告日")) if "预案公告日" in columns else None
            record = to_iso_date(row.get("股权登记日")) if "股权登记日" in columns else None
            ex_date = to_iso_date(row.get("除权除息日")) if "除权除息日" in columns else None

            status = self._resolve_status(progress, ex_date)
            source_key = f"{key_prefix}:{instrument.fetch_symbol}:{period or announce or ex_date}"

            events.append(
                DividendEvent(
                    instrument_id=instrument.id,
                    per_share_amount=round(per_share, 6),
                    currency=instrument.currency,
                    source_key=source_key,
                    status=status,
                    announce_date=announce,
                    record_date=record,
                    # A股现金红利通常在除权除息日当日到账，没有独立的派息日字段，
                    # 因此用除息日作为估计派息日并标记 estimated。
                    ex_date=ex_date,
                    pay_date=ex_date,
                    pay_date_estimated=True,
                    dividend_form=_resolve_form(per_share, scrip_per_10),
                    is_special=None,
                    is_estimate=status in {"PROPOSED", "APPROVED"},
                    manual=False,
                )
            )
        return events

    @staticmethod
    def _resolve_status(progress: str, ex_date: str | None) -> str:
        """把「方案进度」+ 除息日推断为前端 DividendStatus。

        规则（为什么这样定）：
        - 预案/预披露阶段金额与日期都可能变，只能是 PROPOSED。
        - 进入「实施分配」后，以除息日与今天的相对位置细化：
          未来=DECLARED，当天=EX_DIVIDEND，过去=PAID
          （A股现金红利除息日当日到账，故过去即视为已派发）。

        Args:
            progress: 东财「方案进度」原始值。
            ex_date: 除权除息日（可能为 None）。

        Returns:
            DividendStatus 字符串。
        """
        base = "DECLARED"
        for keyword, mapped in A_SHARE_PROGRESS_MAP.items():
            if keyword in progress:
                base = mapped
                break

        if base != "DECLARED" or not ex_date:
            return base

        current = today().strftime("%Y-%m-%d")
        if ex_date > current:
            return "DECLARED"
        if ex_date == current:
            return "EX_DIVIDEND"
        return "PAID"


def _resolve_form(cash_per_share: float, scrip_per_10: float) -> str:
    """根据现金/送转比例判定分红形式。

    Args:
        cash_per_share: 每股现金分红。
        scrip_per_10: 每 10 股送转比例。

    Returns:
        'CASH' / 'SCRIP' / 'CASH_SCRIP'。
    """
    has_cash = cash_per_share > 0
    has_scrip = scrip_per_10 > 0
    if has_cash and has_scrip:
        return "CASH_SCRIP"
    if has_scrip:
        return "SCRIP"
    return "CASH"


def _frame_to_prices(
    frame: pd.DataFrame,
    instrument: InstrumentConfig,
    source_label: str,
    date_column: str = "日期",
    close_column: str = "收盘",
) -> list[PriceSnapshot]:
    """把东财风格的日线表转成 PriceSnapshot 列表。

    该函数被 A股/港股/ETF 三个 provider 共用（列名一致）。

    Args:
        frame: 原始日线 DataFrame。
        instrument: 标的配置。
        source_label: 写入 `PriceSnapshot.source` 的展示名。
        date_column: 日期列名。
        close_column: 收盘价列名。

    Returns:
        PriceSnapshot 列表（脏行被跳过，不抛异常）。
    """
    if frame is None or frame.empty:
        return []
    if date_column not in frame.columns or close_column not in frame.columns:
        raise ValueError(
            f"列结构异常：期望 {date_column}/{close_column}，实际 {list(frame.columns)}"
        )

    snapshots: list[PriceSnapshot] = []
    for _, row in frame.iterrows():
        iso = to_iso_date(row.get(date_column))
        close = safe_float(row.get(close_column))
        if not iso or close is None:
            continue
        snapshots.append(
            PriceSnapshot(
                instrument_id=instrument.id,
                date=iso,
                price=round(close, 6),
                currency=instrument.currency,
                fx_rate=1.0,  # 由编排器统一回填
                source=source_label,
            )
        )
    return snapshots

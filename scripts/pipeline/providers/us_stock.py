"""美股 provider：东财行情（+ 新浪备源）与 Nasdaq 分红。

实测结论
--------
- `stock_us_hist`：0.28s，**代码必须带市场前缀**（105=NASDAQ / 106=NYSE）。
- `stock_us_daily`（新浪）：0.34s / 10003 行全历史，裸代码 `AAPL`，作为备源。
- `yfinance`：HTTP 429 限流，不采用。
- **Nasdaq 官方 API**（本轮新发现，实测可用）：
  `https://api.nasdaq.com/api/quote/AAPL/dividends?assetclass=stocks`
  返回 83 条完整分红历史，含 declarationDate / exOrEffDate / recordDate /
  paymentDate / amount / currency —— 是四个市场里字段最完整的分红源。
  注意它会返回**未来已宣派**的分红（如 ex 2026-08-10），这是有效数据。
"""

from __future__ import annotations

import os
from typing import Any

os.environ.setdefault("TQDM_DISABLE", "1")

import akshare as ak
import pandas as pd

from config import DEFAULT_TIMEOUT_S, NASDAQ_DIVIDENDS, InstrumentConfig
from models import DividendEvent, PriceSnapshot
from providers.base import (
    BaseProvider,
    SourceCandidate,
    compact_date,
    http_get_json,
    parse_us_date,
    safe_float,
    to_iso_date,
    today,
)


class UsStockProvider(BaseProvider):
    """美股行情与分红。"""

    name = "us_stock"

    # ------------------------------------------------------------ 行情
    def price_candidates(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[SourceCandidate[list[PriceSnapshot]]]:
        """构建美股行情降级链（东财 → 新浪）。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            候选源列表。
        """
        return [
            SourceCandidate(
                name="akshare.stock_us_hist",
                label="akshare·东财美股",
                fn=lambda: self._hist_em(instrument, start, end),
            ),
            SourceCandidate(
                name="akshare.stock_us_daily",
                label="akshare·新浪美股",
                fn=lambda: self._hist_sina(instrument, start, end),
            ),
        ]

    def _hist_em(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[PriceSnapshot]:
        """东财美股日线（需 105./106. 前缀）。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            PriceSnapshot 列表。
        """
        frame = ak.stock_us_hist(
            symbol=instrument.fetch_symbol,
            period="daily",
            start_date=compact_date(start),
            end_date=compact_date(end),
            adjust="qfq",
        )
        if frame is None or frame.empty:
            return []
        return _rows_to_prices(
            frame, instrument, "akshare·东财美股", "日期", "收盘", start, end
        )

    def _hist_sina(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[PriceSnapshot]:
        """新浪美股日线备源（返回全历史，需自行按窗口过滤）。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            PriceSnapshot 列表。
        """
        symbol = instrument.alt_symbol or instrument.fetch_symbol.split(".")[-1]
        frame = ak.stock_us_daily(symbol=symbol, adjust="")
        if frame is None or frame.empty:
            return []
        return _rows_to_prices(
            frame, instrument, "akshare·新浪美股", "date", "close", start, end
        )

    # ------------------------------------------------------------ 分红
    def dividend_candidates(
        self, instrument: InstrumentConfig
    ) -> list[SourceCandidate[list[DividendEvent]]]:
        """构建美股分红降级链。

        Args:
            instrument: 标的配置。

        Returns:
            候选源列表。
        """
        return [
            SourceCandidate(
                name="nasdaq.api.dividends",
                label="Nasdaq·官方分红",
                fn=lambda: self._dividends_nasdaq(instrument),
            )
        ]

    def _dividends_nasdaq(self, instrument: InstrumentConfig) -> list[DividendEvent]:
        """解析 Nasdaq 官方分红接口。

        Args:
            instrument: 标的配置。

        Returns:
            DividendEvent 列表。
        """
        symbol = instrument.alt_symbol or instrument.symbol
        payload = http_get_json(
            NASDAQ_DIVIDENDS.format(symbol=symbol), timeout=DEFAULT_TIMEOUT_S
        )
        data = (payload or {}).get("data") or {}
        rows = ((data.get("dividends") or {}).get("rows")) or []

        events: list[DividendEvent] = []
        for row in rows:
            amount = safe_float(row.get("amount"))
            if amount is None or amount <= 0:
                continue

            ex_date = parse_us_date(row.get("exOrEffDate"))
            record_date = parse_us_date(row.get("recordDate"))
            pay_date = parse_us_date(row.get("paymentDate"))
            announce_date = parse_us_date(row.get("declarationDate"))
            dividend_type = str(row.get("type", "") or "")
            currency = str(row.get("currency", "") or "USD").upper()
            if currency not in {"USD", "CNY", "HKD"}:
                # 契约只支持三种币种，非美元 ADR 分红先跳过而不是错标
                continue

            events.append(
                DividendEvent(
                    instrument_id=instrument.id,
                    per_share_amount=round(amount, 6),
                    currency=currency,  # type: ignore[arg-type]
                    source_key=f"nasdaq:div:{symbol}:{ex_date or pay_date}",
                    status=_resolve_us_status(ex_date, pay_date),
                    announce_date=announce_date,
                    record_date=record_date,
                    ex_date=ex_date,
                    pay_date=pay_date,
                    # Nasdaq 给的是真实派息日，不是推算值
                    pay_date_estimated=pay_date is None,
                    dividend_form="SCRIP" if "stock" in dividend_type.lower() else "CASH",
                    is_special="special" in dividend_type.lower(),
                    is_estimate=None,
                    manual=False,
                )
            )
        return events


def _rows_to_prices(
    frame: pd.DataFrame,
    instrument: InstrumentConfig,
    source_label: str,
    date_column: str,
    close_column: str,
    start: str,
    end: str,
) -> list[PriceSnapshot]:
    """把美股日线表按窗口过滤后转成 PriceSnapshot。

    Args:
        frame: 原始 DataFrame。
        instrument: 标的配置。
        source_label: 展示用源名。
        date_column: 日期列名。
        close_column: 收盘价列名。
        start: 窗口起始日期。
        end: 窗口结束日期。

    Returns:
        PriceSnapshot 列表。
    """
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
        if iso < start or iso > end:
            continue
        snapshots.append(
            PriceSnapshot(
                instrument_id=instrument.id,
                date=iso,
                price=round(close, 6),
                currency=instrument.currency,
                fx_rate=1.0,
                source=source_label,
            )
        )
    return snapshots


def _resolve_us_status(ex_date: str | None, pay_date: str | None) -> str:
    """推断美股分红状态。

    Nasdaq 提供真实派息日，因此可以直接依据派息日判断是否已发放，
    无需像港股那样做滞后推断。

    Args:
        ex_date: 除息日。
        pay_date: 派息日。

    Returns:
        DividendStatus 字符串。
    """
    current = today().strftime("%Y-%m-%d")
    if pay_date and pay_date <= current:
        return "PAID"
    if ex_date:
        if ex_date == current:
            return "EX_DIVIDEND"
        if ex_date < current:
            # 已除息但还没到派息日
            return "EX_DIVIDEND"
    return "DECLARED"

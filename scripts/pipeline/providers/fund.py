"""场外基金 provider：天天基金净值 + 分红。

实测结论
--------
- `fund_open_fund_info_em(symbol, indicator='单位净值走势')`：0.37s / 4370 行全历史，
  列为 净值日期 / 单位净值 / 日增长率。该接口不支持日期区间参数，需自行过滤。
- `fund_fh_em()`：11.4s / 7500 行全市场分红表。**110011 实测 0 条记录**——
  这是合法的"空"（该 QDII 基金没有分红派息记录），不是抓取失败，
  因此该候选源标记 `allow_empty=True`，避免误判为故障触发熔断。
"""

from __future__ import annotations

import os
from typing import Any

os.environ.setdefault("TQDM_DISABLE", "1")

import akshare as ak
import pandas as pd

from config import InstrumentConfig
from models import DividendEvent, PriceSnapshot
from providers.base import (
    BaseProvider,
    SourceCandidate,
    safe_float,
    to_iso_date,
    today,
)


class FundProvider(BaseProvider):
    """场外基金净值与分红。"""

    name = "fund"

    # ------------------------------------------------------------ 净值
    def price_candidates(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[SourceCandidate[list[PriceSnapshot]]]:
        """构建基金净值降级链。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            候选源列表。
        """
        return [
            SourceCandidate(
                name="akshare.fund_open_fund_info_em",
                label="akshare·天天基金净值",
                fn=lambda: self._nav(instrument, start, end),
            )
        ]

    def _nav(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[PriceSnapshot]:
        """拉取单位净值走势并按窗口过滤。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            PriceSnapshot 列表，`nav_date` 与 `date` 同为净值日期。
        """
        frame = ak.fund_open_fund_info_em(
            symbol=instrument.fetch_symbol, indicator="单位净值走势"
        )
        if frame is None or frame.empty:
            return []
        if "净值日期" not in frame.columns or "单位净值" not in frame.columns:
            raise ValueError(f"列结构异常：{list(frame.columns)}")

        snapshots: list[PriceSnapshot] = []
        for _, row in frame.iterrows():
            iso = to_iso_date(row.get("净值日期"))
            nav = safe_float(row.get("单位净值"))
            if not iso or nav is None:
                continue
            if iso < start or iso > end:
                continue
            snapshots.append(
                PriceSnapshot(
                    instrument_id=instrument.id,
                    date=iso,
                    price=round(nav, 6),
                    currency=instrument.currency,
                    fx_rate=1.0,
                    # 基金净值 T+1 披露，navDate 即净值所属日期，
                    # 前端据此显示"净值日期"角标
                    source="akshare·天天基金净值",
                    nav_date=iso,
                )
            )
        return snapshots

    # ------------------------------------------------------------ 分红
    def dividend_candidates(
        self, instrument: InstrumentConfig
    ) -> list[SourceCandidate[list[DividendEvent]]]:
        """构建基金分红降级链。

        Args:
            instrument: 标的配置。

        Returns:
            候选源列表。
        """
        return [
            SourceCandidate(
                name="akshare.fund_fh_em",
                label="akshare·天天基金分红",
                # 无分红记录是合法结果，不能当失败
                allow_empty=True,
                fn=lambda: self._dividends(instrument),
            )
        ]

    def _dividends(self, instrument: InstrumentConfig) -> list[DividendEvent]:
        """从全市场基金分红表中筛出本基金。

        Args:
            instrument: 标的配置。

        Returns:
            DividendEvent 列表（可能为空）。
        """
        frame = ak.fund_fh_em()
        if frame is None or frame.empty or "基金代码" not in frame.columns:
            return []

        matched = frame[frame["基金代码"].astype(str) == instrument.fetch_symbol]
        if matched.empty:
            return []

        events: list[DividendEvent] = []
        for _, row in matched.iterrows():
            amount = safe_float(row.get("分红"))
            if amount is None or amount <= 0:
                continue
            record_date = to_iso_date(row.get("权益登记日"))
            ex_date = to_iso_date(row.get("除息日期"))
            pay_date = to_iso_date(row.get("分红发放日"))
            anchor = record_date or ex_date or pay_date

            events.append(
                DividendEvent(
                    instrument_id=instrument.id,
                    per_share_amount=round(amount, 6),
                    currency=instrument.currency,
                    source_key=f"em:fundfh:{instrument.fetch_symbol}:{anchor}",
                    status=_resolve_fund_status(pay_date, ex_date),
                    announce_date=None,
                    record_date=record_date,
                    ex_date=ex_date,
                    pay_date=pay_date,
                    pay_date_estimated=pay_date is None,
                    dividend_form="CASH",
                    is_special=None,
                    is_estimate=None,
                    manual=False,
                )
            )
        return events


def _resolve_fund_status(pay_date: str | None, ex_date: str | None) -> str:
    """推断基金分红状态。

    Args:
        pay_date: 分红发放日。
        ex_date: 除息日期。

    Returns:
        DividendStatus 字符串。
    """
    current = today().strftime("%Y-%m-%d")
    if pay_date:
        return "PAID" if pay_date <= current else "DECLARED"
    if ex_date:
        if ex_date < current:
            return "EX_DIVIDEND"
        if ex_date == current:
            return "EX_DIVIDEND"
    return "DECLARED"

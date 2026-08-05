"""港股 provider：东财行情 + 分红派息。

实测结论（akshare 1.18.22）
--------------------------
- `stock_hk_hist`：0.27s / 25 行，可用。
- `stock_hk_fhpx_detail_ths`（同花顺）：**已失效**，`ValueError: No tables found`，
  源站改版。按需求保留在链上，捕获异常后降级。
- `stock_hk_dividend_payout_em`（东财）：**实测可用**，0.09s / 27 行，
  是本轮找到的替代源。列：最新公告日期/财政年度/分红方案/分配类型/
  除净日/截至过户日/发放日。

两个坑
------
1. 「发放日」列实测 100% 为空（00700/00005/01299 共 152 行无一有值），
   因此港股 payDate 永远为 None 且 payDateEstimated=True。
2. 「分红方案」的币种不固定：腾讯是「每股派港币5.3元」，汇丰是
   「每股派美元0.1元(相当于港币0.784234元(计算值))」。需要正则解析币种。
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from typing import Any

os.environ.setdefault("TQDM_DISABLE", "1")

import akshare as ak
import pandas as pd

from config import HK_PAY_LAG_DAYS, InstrumentConfig
from models import DividendEvent, PriceSnapshot
from providers.base import (
    BaseProvider,
    SourceCandidate,
    compact_date,
    safe_float,
    to_iso_date,
    today,
)
from providers.cn_stock import _frame_to_prices

# 「每股派港币5.3元」/「每股派美元0.1元」
_PLAN_PATTERN = re.compile(r"每股派\s*([\u4e00-\u9fa5]+?)\s*([\d.]+)\s*元")
# 「(相当于港币0.784234元(计算值))」
_HKD_EQUIV_PATTERN = re.compile(r"相当于港币\s*([\d.]+)\s*元")

_CURRENCY_MAP: dict[str, str] = {
    "港币": "HKD",
    "港元": "HKD",
    "美元": "USD",
    "美金": "USD",
    "人民币": "CNY",
}


class HkStockProvider(BaseProvider):
    """港股行情与分红。"""

    name = "hk_stock"

    # ------------------------------------------------------------ 行情
    def price_candidates(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[SourceCandidate[list[PriceSnapshot]]]:
        """构建港股行情降级链。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            候选源列表。
        """
        return [
            SourceCandidate(
                name="akshare.stock_hk_hist",
                label="akshare·东财港股",
                fn=lambda: self._hist(instrument, start, end),
            )
        ]

    def _hist(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[PriceSnapshot]:
        """拉取港股前复权日线。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            PriceSnapshot 列表。
        """
        frame = ak.stock_hk_hist(
            symbol=instrument.fetch_symbol,
            period="daily",
            start_date=compact_date(start),
            end_date=compact_date(end),
            adjust="qfq",
        )
        return _frame_to_prices(frame, instrument, "akshare·东财港股")

    # ------------------------------------------------------------ 分红
    def dividend_candidates(
        self, instrument: InstrumentConfig
    ) -> list[SourceCandidate[list[DividendEvent]]]:
        """构建港股分红降级链。

        东财派息表为首选；同花顺源虽已失效仍保留在链尾，
        一旦对方修复即可自动重新启用。

        Args:
            instrument: 标的配置。

        Returns:
            候选源列表。
        """
        return [
            SourceCandidate(
                name="akshare.stock_hk_dividend_payout_em",
                label="akshare·东财港股派息",
                fn=lambda: self._dividends_em(instrument),
            ),
            SourceCandidate(
                name="akshare.stock_hk_fhpx_detail_ths",
                label="akshare·同花顺港股分红(已失效)",
                fn=lambda: self._dividends_ths(instrument),
            ),
        ]

    def _dividends_em(self, instrument: InstrumentConfig) -> list[DividendEvent]:
        """解析东财港股派息表。

        Args:
            instrument: 标的配置。

        Returns:
            DividendEvent 列表。
        """
        frame = ak.stock_hk_dividend_payout_em(symbol=instrument.fetch_symbol)
        if frame is None or frame.empty:
            return []

        events: list[DividendEvent] = []
        seen_keys: set[str] = set()
        for _, row in frame.iterrows():
            plan = str(row.get("分红方案", "") or "")
            amount, currency = _parse_hk_plan(plan, instrument.currency)
            if amount is None or amount <= 0:
                # 无法解析金额（如纯以股代息或非常规表述）→ 跳过而非写入脏数据
                continue

            ex_date = to_iso_date(row.get("除净日"))
            announce = to_iso_date(row.get("最新公告日期"))
            record = _parse_book_close(row.get("截至过户日"))
            pay_date = to_iso_date(row.get("发放日"))
            category = str(row.get("分配类型", "") or "")
            fiscal_year = str(row.get("财政年度", "") or "")

            # sourceKey 必须带上「分配类型」：实测腾讯 FY2008 在同一除净日
            # (2009-05-06) 同时派发「年度分配 HK$0.25」与「特别分配 HK$0.10」，
            # 只用 (代码,财年,除净日) 会让两条真实分红互相覆盖、静默丢数据。
            base_key = (
                f"em:hkdiv:{instrument.fetch_symbol}:{fiscal_year}:"
                f"{ex_date or announce}:{category}"
            )
            source_key = _dedupe_key(base_key, seen_keys)

            events.append(
                DividendEvent(
                    instrument_id=instrument.id,
                    per_share_amount=round(amount, 6),
                    currency=currency,  # type: ignore[arg-type]
                    source_key=source_key,
                    status=_resolve_hk_status(ex_date, pay_date),
                    announce_date=announce,
                    record_date=record,
                    ex_date=ex_date,
                    pay_date=pay_date,
                    # 实测该源发放日恒为空，故派息日始终是估计值
                    pay_date_estimated=pay_date is None,
                    dividend_form="CASH_SCRIP" if "以股代息" in plan else "CASH",
                    is_special="特别" in category,
                    is_estimate=None,
                    manual=False,
                )
            )
        return events

    def _dividends_ths(self, instrument: InstrumentConfig) -> list[DividendEvent]:
        """同花顺港股分红（源站已改版，保留以便未来自动恢复）。

        Args:
            instrument: 标的配置。

        Returns:
            DividendEvent 列表。

        Raises:
            Exception: 源站失效时由 akshare 抛出，交由 ResilientFetcher 降级。
        """
        frame = ak.stock_hk_fhpx_detail_ths(symbol=instrument.fetch_symbol)
        if frame is None or frame.empty:
            return []

        events: list[DividendEvent] = []
        for _, row in frame.iterrows():
            plan = str(row.get("方案", "") or row.get("分红方案", "") or "")
            amount, currency = _parse_hk_plan(plan, instrument.currency)
            if amount is None or amount <= 0:
                continue
            ex_date = to_iso_date(row.get("除净日") or row.get("除权除息日"))
            events.append(
                DividendEvent(
                    instrument_id=instrument.id,
                    per_share_amount=round(amount, 6),
                    currency=currency,  # type: ignore[arg-type]
                    source_key=f"ths:hkdiv:{instrument.fetch_symbol}:{ex_date}",
                    status=_resolve_hk_status(ex_date, None),
                    announce_date=to_iso_date(row.get("公告日期")),
                    record_date=to_iso_date(row.get("股权登记日")),
                    ex_date=ex_date,
                    pay_date=to_iso_date(row.get("派息日")),
                    pay_date_estimated=True,
                    dividend_form="CASH",
                    manual=False,
                )
            )
        return events


def _dedupe_key(base_key: str, seen: set[str]) -> str:
    """保证 sourceKey 在同一批数据内唯一。

    即便加上了「分配类型」，理论上仍可能出现同年同日同类型的两笔派息。
    这里做最后一道保险：按源返回顺序追加 `#n` 后缀。源的行顺序是稳定的
    （按公告日倒序），因此重复运行仍能得到相同的 key，不破坏幂等性。

    Args:
        base_key: 原始 key。
        seen: 已使用过的 key 集合（就地更新）。

    Returns:
        唯一的 sourceKey。
    """
    key = base_key
    suffix = 2
    while key in seen:
        key = f"{base_key}#{suffix}"
        suffix += 1
    seen.add(key)
    return key


def _parse_hk_plan(plan: str, instrument_currency: str) -> tuple[float | None, str]:
    """解析港股「分红方案」文本，提取每股金额与币种。

    策略：若文本同时给出原币金额与港币折算值，且标的以港币计价，
    优先采用港币折算值 —— 因为前端契约要求 `perShareAmount` 是**标的币种**金额。

    Args:
        plan: 形如「每股派美元0.1元(相当于港币0.784234元(计算值))」。
        instrument_currency: 标的计价币种。

    Returns:
        (每股金额, 币种)；无法解析时金额为 None。
    """
    if not plan:
        return None, instrument_currency

    equivalent = _HKD_EQUIV_PATTERN.search(plan)
    if equivalent and instrument_currency == "HKD":
        value = safe_float(equivalent.group(1))
        if value is not None:
            return value, "HKD"

    match = _PLAN_PATTERN.search(plan)
    if not match:
        return None, instrument_currency

    currency_cn, raw_amount = match.group(1), match.group(2)
    currency = _CURRENCY_MAP.get(currency_cn)
    value = safe_float(raw_amount)
    if value is None:
        return None, instrument_currency
    if currency is None:
        # 前端 Currency 只支持 CNY/USD/HKD；其他币种（英镑等）若有港币折算则用之，
        # 否则放弃该条，避免把币种标错造成金额口径错误。
        if equivalent:
            equivalent_value = safe_float(equivalent.group(1))
            if equivalent_value is not None:
                return equivalent_value, "HKD"
        return None, instrument_currency
    return value, currency


def _parse_book_close(value: Any) -> str | None:
    """解析「截至过户日」区间，取区间末日作为股权登记日。

    实测格式为 `'2026/05/19-2026/05/20'`（停止过户期），
    港股的股权登记日是该期间的最后一天。

    Args:
        value: 原始单元格值。

    Returns:
        ISO 日期字符串；无法解析返回 None。
    """
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    text = str(value).strip()
    if not text or text in {"-", "--"}:
        return None
    parts = [p.strip() for p in text.split("-") if p.strip()]
    # 'YYYY/MM/DD-YYYY/MM/DD' 按 '-' 切会得到两段完整日期
    if len(parts) >= 2 and all("/" in p for p in parts[:2]):
        return to_iso_date(parts[-1])
    return to_iso_date(text)


def _resolve_hk_status(ex_date: str | None, pay_date: str | None) -> str:
    """推断港股分红状态。

    港股派息日普遍比除净日晚 2~6 周，且东财源不提供发放日，
    因此不能像 A 股那样"除息即视为已派"。这里用 `HK_PAY_LAG_DAYS`
    做保守推断：超过滞后期才判定 PAID，否则停留在 EX_DIVIDEND
    交由用户在前端核对。

    Args:
        ex_date: 除净日。
        pay_date: 发放日（该源恒为 None）。

    Returns:
        DividendStatus 字符串。
    """
    current = today()
    current_iso = current.strftime("%Y-%m-%d")

    if pay_date:
        return "PAID" if pay_date <= current_iso else "DECLARED"
    if not ex_date:
        return "DECLARED"
    if ex_date > current_iso:
        return "DECLARED"
    if ex_date == current_iso:
        return "EX_DIVIDEND"

    lag_cutoff = (current - timedelta(days=HK_PAY_LAG_DAYS)).strftime("%Y-%m-%d")
    return "PAID" if ex_date < lag_cutoff else "EX_DIVIDEND"

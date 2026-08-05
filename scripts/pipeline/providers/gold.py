"""黄金 provider：黄金 ETF 代理 + XAU 现货折算。

为什么不用上金所
----------------
`ak.spot_hist_sge(symbol='Au99.99')` 实测 SSLError（`www.sge.com.cn` TLS 握手
直接被关闭），且不是偶发。因此改用代理源。

单位换算的坑（重要）
--------------------
Au99.99 的报价口径是 **CNY/克**（种子数据约 450~900 元/克），而华安黄金 ETF
518880 的份额净值只有 8.5 元左右 —— 两者相差约两个数量级。若直接把 ETF 价格
写进 prices.json，资产曲线会瞬间失真 100 倍。

- 主源：ETF 价格 × `GOLD_ETF_TO_GRAM_FACTOR`(=100)。每份额约对应 0.01 克。
  这是**近似值**：ETF 份额会因管理费逐年缓慢损耗，实测与 XAU 折算价差约 5%。
- 备源：gold-api 的 XAU（USD/盎司）→ CNY/克，单位换算是精确的，
  但国际现货与上金所内盘存在升贴水。

两条路都是代理，故该标的健康度最高只标到 YELLOW，并在 meta.warnings 中提示。
"""

from __future__ import annotations

import os
from typing import Any, Callable

os.environ.setdefault("TQDM_DISABLE", "1")

import akshare as ak

from config import (
    DEFAULT_TIMEOUT_S,
    GOLD_API_PRICE,
    GOLD_ETF_TO_GRAM_FACTOR,
    TROY_OUNCE_IN_GRAMS,
    InstrumentConfig,
)
from models import PriceSnapshot
from providers.base import (
    BaseProvider,
    ResilientFetcher,
    SourceCandidate,
    compact_date,
    http_get_json,
    safe_float,
    to_iso_date,
    today,
)
from providers.cn_stock import _frame_to_prices


class GoldProvider(BaseProvider):
    """黄金行情（无分红）。"""

    name = "gold"

    def __init__(
        self,
        fetcher: ResilientFetcher,
        usd_cny_getter: Callable[[], float | None] | None = None,
    ) -> None:
        """初始化。

        Args:
            fetcher: 共享抓取器。
            usd_cny_getter: 返回当前 USD→CNY 汇率的回调。
                XAU 备源需要它把美元/盎司折成人民币/克；
                取不到汇率时该备源会被跳过（宁可缺数据也不写错数据）。
        """
        super().__init__(fetcher)
        self._usd_cny_getter = usd_cny_getter or (lambda: None)

    def price_candidates(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[SourceCandidate[list[PriceSnapshot]]]:
        """构建黄金行情降级链。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            候选源列表。
        """
        return [
            SourceCandidate(
                name="akshare.fund_etf_hist_em",
                label="akshare·黄金ETF518880(代理)",
                fn=lambda: self._etf_proxy(instrument, start, end),
            ),
            SourceCandidate(
                name="gold-api.xau",
                label="gold-api·XAU折算(代理)",
                fn=lambda: self._xau_spot(instrument),
            ),
            SourceCandidate(
                name="akshare.spot_hist_sge",
                label="上金所·Au99.99(SSL不可用)",
                fn=lambda: self._sge(instrument, start, end),
            ),
        ]

    def _etf_proxy(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[PriceSnapshot]:
        """黄金 ETF 日线 → 折算 CNY/克。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            PriceSnapshot 列表。
        """
        frame = ak.fund_etf_hist_em(
            symbol=instrument.fetch_symbol,
            period="daily",
            start_date=compact_date(start),
            end_date=compact_date(end),
            adjust="",
        )
        snapshots = _frame_to_prices(
            frame, instrument, "akshare·黄金ETF518880(代理)"
        )
        for snapshot in snapshots:
            snapshot.price = round(snapshot.price * GOLD_ETF_TO_GRAM_FACTOR, 4)
        return snapshots

    def _xau_spot(self, instrument: InstrumentConfig) -> list[PriceSnapshot]:
        """XAU 国际现货（USD/盎司）→ CNY/克。

        Args:
            instrument: 标的配置。

        Returns:
            单元素 PriceSnapshot 列表。

        Raises:
            ValueError: 缺少汇率或响应异常时抛出，由抓取器降级。
        """
        usd_cny = self._usd_cny_getter()
        if not usd_cny or usd_cny <= 0:
            raise ValueError("缺少 USD/CNY 汇率，无法把 XAU 折算为 CNY/克")

        payload = http_get_json(
            GOLD_API_PRICE.format(symbol="XAU"), timeout=DEFAULT_TIMEOUT_S
        )
        usd_per_ounce = safe_float((payload or {}).get("price"))
        if usd_per_ounce is None:
            raise ValueError(f"gold-api 未返回 price: {payload}")

        cny_per_gram = usd_per_ounce * usd_cny / TROY_OUNCE_IN_GRAMS
        iso = to_iso_date(str((payload or {}).get("updatedAt", "")).split("T")[0])
        return [
            PriceSnapshot(
                instrument_id=instrument.id,
                date=iso or today().strftime("%Y-%m-%d"),
                price=round(cny_per_gram, 4),
                currency=instrument.currency,
                fx_rate=1.0,
                source="gold-api·XAU折算(代理)",
            )
        ]

    def _sge(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[PriceSnapshot]:
        """上金所现货（当前 SSL 不可用，保留以便源恢复后自动启用）。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            PriceSnapshot 列表。

        Raises:
            Exception: SSL 握手失败时由 akshare 抛出。
        """
        frame = ak.spot_hist_sge(symbol="Au99.99")
        if frame is None or frame.empty:
            return []

        snapshots: list[PriceSnapshot] = []
        for _, row in frame.iterrows():
            iso = to_iso_date(row.get("date") or row.get("日期"))
            close = safe_float(row.get("close") or row.get("收盘价"))
            if not iso or close is None:
                continue
            if iso < start or iso > end:
                continue
            snapshots.append(
                PriceSnapshot(
                    instrument_id=instrument.id,
                    date=iso,
                    price=round(close, 4),
                    currency=instrument.currency,
                    fx_rate=1.0,
                    source="上金所·Au99.99",
                )
            )
        return snapshots

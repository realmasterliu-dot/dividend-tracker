"""加密货币 provider：多源降级链。

网络现实（境内沙箱实测 2026-08-05）
----------------------------------
| 源 | 结果 |
|---|---|
| `api.binance.com` | ReadTimeout（被墙） |
| `api.coinbase.com` | SSLError |
| `api.coingecko.com` | SSLError |
| `www.okx.com` | ConnectionError |
| `api.kraken.com` / `bitstamp` | SSLError |
| **`api.gold-api.com/price/BTC`** | **✅ 0.8s，价格新鲜（updatedAt = 当前时刻）** |
| `ak.crypto_js_spot()` | ⚠ HTTP 成功但**数据停在 2023-10-02**（陈旧 3 年） |

设计取舍
--------
1. Binance klines 排在链首：它是唯一能提供**历史K线**的源，在 GitHub Actions
   境外 runner 上大概率可用；境内失败会被快速失败 + 熔断跳过，不拖慢整轮。
2. gold-api 只有现价（单点），因此境内环境下 BTC 只能逐日累积历史。
3. `crypto_js_spot` 放在链尾且**必须带上源自身的时间戳**，让质量闸门的
   新鲜度规则能把 2023 年的陈旧价拦下来 —— 这是本管道最容易被静默污染的一处。
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

os.environ.setdefault("TQDM_DISABLE", "1")

import akshare as ak

from config import (
    BINANCE_KLINES,
    COINBASE_SPOT,
    COINGECKO_SPOT,
    DEFAULT_TIMEOUT_S,
    GOLD_API_PRICE,
    InstrumentConfig,
)
from models import PriceSnapshot
from providers.base import (
    BaseProvider,
    SourceCandidate,
    http_get_json,
    safe_float,
    to_iso_date,
    today,
)


class CryptoProvider(BaseProvider):
    """加密货币行情（无分红）。"""

    name = "crypto"

    def price_candidates(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[SourceCandidate[list[PriceSnapshot]]]:
        """构建加密行情降级链。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            候选源列表，按"能给历史"→"只给现价"排序。
        """
        return [
            SourceCandidate(
                name="binance.klines",
                label="Binance·日K",
                fn=lambda: self._binance_klines(instrument, start, end),
            ),
            SourceCandidate(
                name="gold-api.crypto",
                label="gold-api·现价",
                fn=lambda: self._gold_api_spot(instrument),
            ),
            SourceCandidate(
                name="coinbase.spot",
                label="Coinbase·现价",
                fn=lambda: self._coinbase_spot(instrument),
            ),
            SourceCandidate(
                name="coingecko.simple",
                label="CoinGecko·现价",
                fn=lambda: self._coingecko_spot(instrument),
            ),
            SourceCandidate(
                name="akshare.crypto_js_spot",
                label="akshare·crypto_js(陈旧风险)",
                fn=lambda: self._crypto_js_spot(instrument),
            ),
        ]

    # ------------------------------------------------------------ 各源实现
    def _binance_klines(
        self, instrument: InstrumentConfig, start: str, end: str
    ) -> list[PriceSnapshot]:
        """Binance 日K（唯一能补历史的源）。

        Args:
            instrument: 标的配置。
            start: 起始日期。
            end: 结束日期。

        Returns:
            PriceSnapshot 列表。
        """
        start_ms = int(
            datetime.strptime(start, "%Y-%m-%d")
            .replace(tzinfo=timezone.utc)
            .timestamp()
            * 1000
        )
        end_ms = int(
            datetime.strptime(end, "%Y-%m-%d")
            .replace(tzinfo=timezone.utc)
            .timestamp()
            * 1000
        ) + 86_400_000
        payload = http_get_json(
            BINANCE_KLINES,
            params={
                "symbol": instrument.alt_symbol or f"{instrument.fetch_symbol}USDT",
                "interval": "1d",
                "startTime": start_ms,
                "endTime": end_ms,
                "limit": 1000,
            },
            timeout=DEFAULT_TIMEOUT_S,
        )
        snapshots: list[PriceSnapshot] = []
        for kline in payload or []:
            if not isinstance(kline, (list, tuple)) or len(kline) < 5:
                continue
            open_time_ms = safe_float(kline[0])
            close_price = safe_float(kline[4])
            if open_time_ms is None or close_price is None:
                continue
            iso = datetime.fromtimestamp(
                open_time_ms / 1000, tz=timezone.utc
            ).strftime("%Y-%m-%d")
            snapshots.append(
                PriceSnapshot(
                    instrument_id=instrument.id,
                    date=iso,
                    price=round(close_price, 2),
                    currency=instrument.currency,
                    fx_rate=1.0,
                    source="Binance·日K",
                )
            )
        return snapshots

    def _gold_api_spot(self, instrument: InstrumentConfig) -> list[PriceSnapshot]:
        """gold-api 现价（境内可用）。

        使用响应里的 `updatedAt` 作为数据日期，而不是本地"今天"——
        这样一旦上游停更，质量闸门的新鲜度规则就能立刻发现。

        Args:
            instrument: 标的配置。

        Returns:
            单元素 PriceSnapshot 列表。
        """
        payload = http_get_json(
            GOLD_API_PRICE.format(symbol=instrument.fetch_symbol),
            timeout=DEFAULT_TIMEOUT_S,
        )
        price = safe_float((payload or {}).get("price"))
        if price is None:
            raise ValueError(f"gold-api 未返回 price 字段: {payload}")
        iso = _iso_from_timestamp((payload or {}).get("updatedAt"))
        return [
            PriceSnapshot(
                instrument_id=instrument.id,
                date=iso,
                price=round(price, 2),
                currency=instrument.currency,
                fx_rate=1.0,
                source="gold-api·现价",
            )
        ]

    def _coinbase_spot(self, instrument: InstrumentConfig) -> list[PriceSnapshot]:
        """Coinbase 现价备源。

        Args:
            instrument: 标的配置。

        Returns:
            单元素 PriceSnapshot 列表。
        """
        pair = f"{instrument.fetch_symbol}-USD"
        payload = http_get_json(
            COINBASE_SPOT.format(pair=pair), timeout=DEFAULT_TIMEOUT_S
        )
        price = safe_float(((payload or {}).get("data") or {}).get("amount"))
        if price is None:
            raise ValueError(f"Coinbase 响应异常: {payload}")
        return [
            PriceSnapshot(
                instrument_id=instrument.id,
                date=today().strftime("%Y-%m-%d"),
                price=round(price, 2),
                currency=instrument.currency,
                fx_rate=1.0,
                source="Coinbase·现价",
            )
        ]

    def _coingecko_spot(self, instrument: InstrumentConfig) -> list[PriceSnapshot]:
        """CoinGecko 现价备源。

        Args:
            instrument: 标的配置。

        Returns:
            单元素 PriceSnapshot 列表。
        """
        gecko_id = _COINGECKO_IDS.get(instrument.fetch_symbol.upper())
        if not gecko_id:
            raise ValueError(f"未配置 CoinGecko id: {instrument.fetch_symbol}")
        payload = http_get_json(
            COINGECKO_SPOT,
            params={"ids": gecko_id, "vs_currencies": "usd"},
            timeout=DEFAULT_TIMEOUT_S,
        )
        price = safe_float(((payload or {}).get(gecko_id) or {}).get("usd"))
        if price is None:
            raise ValueError(f"CoinGecko 响应异常: {payload}")
        return [
            PriceSnapshot(
                instrument_id=instrument.id,
                date=today().strftime("%Y-%m-%d"),
                price=round(price, 2),
                currency=instrument.currency,
                fx_rate=1.0,
                source="CoinGecko·现价",
            )
        ]

    def _crypto_js_spot(self, instrument: InstrumentConfig) -> list[PriceSnapshot]:
        """akshare crypto_js_spot 兜底源（已知会返回陈旧数据）。

        实测该源停更在 2023-10-02 但 HTTP 依然 200。这里**如实带上源的
        「更新时间」**，把陈旧判定交给质量闸门统一处理，而不是在这里悄悄
        用今天的日期覆盖 —— 后者会让三年前的价格伪装成今日价。

        Args:
            instrument: 标的配置。

        Returns:
            单元素 PriceSnapshot 列表。
        """
        frame = ak.crypto_js_spot()
        if frame is None or frame.empty:
            return []

        target = f"{instrument.fetch_symbol.upper()}USD"
        rows = frame[frame["交易品种"].astype(str).str.upper() == target]
        if rows.empty:
            raise ValueError(f"crypto_js_spot 无 {target} 报价")

        row = rows.iloc[0]
        price = safe_float(row.get("最近报价"))
        if price is None:
            raise ValueError("crypto_js_spot 报价解析失败")
        iso = to_iso_date(str(row.get("更新时间", "")).split(" ")[0]) or today().strftime(
            "%Y-%m-%d"
        )
        return [
            PriceSnapshot(
                instrument_id=instrument.id,
                date=iso,
                price=round(price, 2),
                currency=instrument.currency,
                fx_rate=1.0,
                source="akshare·crypto_js",
            )
        ]


#: CoinGecko 的 coin id 映射
_COINGECKO_IDS: dict[str, str] = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
}


def _iso_from_timestamp(value: Any) -> str:
    """从 ISO-8601 时间戳里提取日期部分。

    Args:
        value: 形如 `'2026-08-05T03:24:13Z'` 的字符串。

    Returns:
        ISO 日期字符串；解析失败时回落到今天。
    """
    iso = to_iso_date(str(value).split("T")[0]) if value else None
    return iso or today().strftime("%Y-%m-%d")

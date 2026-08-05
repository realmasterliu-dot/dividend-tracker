"""汇率 provider：Frankfurter 主源 + open.er-api 备源。

实测结论
--------
- `api.frankfurter.app`（旧 `.app` 域名）→ HTTP 403，**必须用 `.dev`**。
- `https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,HKD` → 0.65s ✅
- `https://api.frankfurter.dev/v1/{start}..{end}?base=USD&symbols=CNY,HKD`
  → 一次请求拿整段历史（实测 12 天 0.65s），冷启动回填靠它。
- `https://open.er-api.com/v6/latest/USD` → 0.65s ✅（仅现价，无历史）

汇率对推导
----------
两个源都以 USD 为基准返回 CNY / HKD，故：
  USDCNY = rates.CNY
  HKDCNY = rates.CNY / rates.HKD   （用交叉汇率而非再发一次请求）
反向对取倒数。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from config import (
    DEFAULT_TIMEOUT_S,
    ER_API_LATEST,
    FRANKFURTER_LATEST,
    FRANKFURTER_RANGE,
)
from models import FxSnapshot
from providers.base import (
    ChainResult,
    ResilientFetcher,
    SourceCandidate,
    http_get_json,
    safe_float,
    to_iso_date,
    today,
)


def _build_rates(usd_cny: float, usd_hkd: float | None) -> dict[str, float]:
    """由 USD 基准汇率推导出前端需要的四个汇率对。

    Args:
        usd_cny: 1 USD 兑 CNY。
        usd_hkd: 1 USD 兑 HKD；缺失时 HKD 相关对会被省略。

    Returns:
        形如 `{'USDCNY': 6.75, 'HKDCNY': 0.86, ...}` 的字典。
    """
    rates: dict[str, float] = {
        "USDCNY": round(usd_cny, 6),
        "CNYUSD": round(1.0 / usd_cny, 6) if usd_cny else 0.0,
    }
    if usd_hkd:
        hkd_cny = usd_cny / usd_hkd
        rates["HKDCNY"] = round(hkd_cny, 6)
        rates["CNYHKD"] = round(1.0 / hkd_cny, 6) if hkd_cny else 0.0
    return rates


class FxProvider:
    """汇率抓取。

    不继承 `BaseProvider`，因为汇率是"全局一份"而非"按标的一份"，
    接口形态不同（`fetch(start, end)` 而非 `fetch(instrument, ...)`）。
    """

    name = "fx"

    def __init__(self, fetcher: ResilientFetcher) -> None:
        """初始化。

        Args:
            fetcher: 共享抓取器。
        """
        self.fetcher = fetcher

    def candidates(self, start: str, end: str) -> list[SourceCandidate[list[FxSnapshot]]]:
        """构建汇率降级链。

        Args:
            start: 起始日期。
            end: 结束日期。

        Returns:
            候选源列表。
        """
        return [
            SourceCandidate(
                name="frankfurter.dev.range",
                label="frankfurter.dev·区间",
                fn=lambda: self._frankfurter_range(start, end),
            ),
            SourceCandidate(
                name="frankfurter.dev.latest",
                label="frankfurter.dev·最新",
                fn=self._frankfurter_latest,
            ),
            SourceCandidate(
                name="open.er-api.latest",
                label="open.er-api·最新",
                fn=self._er_api_latest,
            ),
        ]

    def fetch(self, start: str, end: str) -> ChainResult[list[FxSnapshot]]:
        """抓取指定区间的汇率。

        Args:
            start: 起始日期。
            end: 结束日期。

        Returns:
            ChainResult，value 为 FxSnapshot 列表。
        """
        return self.fetcher.run("fx", self.candidates(start, end))

    # ------------------------------------------------------------ 各源实现
    def _frankfurter_range(self, start: str, end: str) -> list[FxSnapshot]:
        """一次请求拉取整段历史汇率（ECB 口径，仅工作日）。

        Args:
            start: 起始日期。
            end: 结束日期。

        Returns:
            FxSnapshot 列表，按日期升序。
        """
        payload = http_get_json(
            FRANKFURTER_RANGE.format(start=start, end=end),
            params={"base": "USD", "symbols": "CNY,HKD"},
            timeout=DEFAULT_TIMEOUT_S,
        )
        raw_rates = (payload or {}).get("rates") or {}

        snapshots: list[FxSnapshot] = []
        for raw_date, values in sorted(raw_rates.items()):
            iso = to_iso_date(raw_date)
            usd_cny = safe_float((values or {}).get("CNY"))
            usd_hkd = safe_float((values or {}).get("HKD"))
            if not iso or usd_cny is None or usd_cny <= 0:
                continue
            snapshots.append(FxSnapshot(date=iso, rates=_build_rates(usd_cny, usd_hkd)))
        return snapshots

    def _frankfurter_latest(self) -> list[FxSnapshot]:
        """Frankfurter 最新汇率（区间接口失败时的降级）。

        Returns:
            单元素 FxSnapshot 列表。
        """
        payload = http_get_json(
            FRANKFURTER_LATEST,
            params={"base": "USD", "symbols": "CNY,HKD"},
            timeout=DEFAULT_TIMEOUT_S,
        )
        values = (payload or {}).get("rates") or {}
        usd_cny = safe_float(values.get("CNY"))
        usd_hkd = safe_float(values.get("HKD"))
        if usd_cny is None or usd_cny <= 0:
            raise ValueError(f"frankfurter 响应异常: {payload}")
        iso = to_iso_date((payload or {}).get("date")) or today().strftime("%Y-%m-%d")
        return [FxSnapshot(date=iso, rates=_build_rates(usd_cny, usd_hkd))]

    def _er_api_latest(self) -> list[FxSnapshot]:
        """open.er-api 备源。

        Returns:
            单元素 FxSnapshot 列表。
        """
        payload = http_get_json(
            ER_API_LATEST.format(base="USD"), timeout=DEFAULT_TIMEOUT_S
        )
        values = (payload or {}).get("rates") or {}
        usd_cny = safe_float(values.get("CNY"))
        usd_hkd = safe_float(values.get("HKD"))
        if usd_cny is None or usd_cny <= 0:
            raise ValueError(f"open.er-api 响应异常: {str(payload)[:120]}")
        # 该源返回的是 RFC-1123 时间串，取其日期部分
        iso = _parse_er_api_date(payload) or today().strftime("%Y-%m-%d")
        return [FxSnapshot(date=iso, rates=_build_rates(usd_cny, usd_hkd))]


def _parse_er_api_date(payload: dict[str, Any]) -> str | None:
    """从 open.er-api 响应里解析更新日期。

    Args:
        payload: 原始响应。

    Returns:
        ISO 日期字符串；失败返回 None。
    """
    unix_ts = safe_float(payload.get("time_last_update_unix"))
    if unix_ts:
        return datetime.utcfromtimestamp(unix_ts).strftime("%Y-%m-%d")
    raw = payload.get("time_last_update_utc")
    if not raw:
        return None
    try:
        return datetime.strptime(str(raw)[:16].strip(), "%a, %d %b %Y").strftime(
            "%Y-%m-%d"
        )
    except ValueError:
        return None


class FxResolver:
    """按日期解析汇率，缺失日自动向前填充。

    汇率源只在工作日更新（ECB 口径），而行情里存在周末/节假日数据点
    （如加密货币 7×24），因此必须做 forward-fill，否则周末的 fxRate 会缺失。
    """

    def __init__(self, snapshots: list[FxSnapshot]) -> None:
        """初始化。

        Args:
            snapshots: 全量汇率快照。
        """
        self._sorted = sorted(snapshots, key=lambda s: s.date)
        self._dates = [s.date for s in self._sorted]

    def rate(self, currency: str, on_date: str, base: str = "CNY") -> float:
        """查询某日 `currency → base` 的汇率。

        Args:
            currency: 源币种。
            on_date: 日期 `yyyy-mm-dd`。
            base: 目标本位币。

        Returns:
            汇率；同币种返回 1.0，查不到时返回 1.0（并由调用方记录警告）。
        """
        if currency == base:
            return 1.0
        snapshot = self._snapshot_on_or_before(on_date)
        if snapshot is None:
            return 1.0
        return snapshot.rates.get(f"{currency}{base}", 1.0) or 1.0

    def latest_rate(self, pair: str) -> float | None:
        """取某个汇率对的最新值。

        Args:
            pair: 形如 `'USDCNY'`。

        Returns:
            最新汇率；无数据返回 None。
        """
        for snapshot in reversed(self._sorted):
            value = snapshot.rates.get(pair)
            if value:
                return value
        return None

    def _snapshot_on_or_before(self, on_date: str) -> FxSnapshot | None:
        """二分查找 <= on_date 的最近一条快照。

        Args:
            on_date: 目标日期。

        Returns:
            FxSnapshot；若目标日早于全部数据则返回最早一条。
        """
        if not self._sorted:
            return None
        low, high = 0, len(self._dates) - 1
        best: FxSnapshot | None = None
        while low <= high:
            mid = (low + high) // 2
            if self._dates[mid] <= on_date:
                best = self._sorted[mid]
                low = mid + 1
            else:
                high = mid - 1
        # 目标日早于所有汇率数据时，用最早一条兜底，避免 fxRate 退化成 1.0
        return best or self._sorted[0]

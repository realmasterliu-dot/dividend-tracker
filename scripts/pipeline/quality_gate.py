"""数据质量闸门。

这是整条管道最重要的防线：爬虫最危险的失败模式不是"抓不到"，而是
**"抓到了但抓错了"** —— 源站改版导致列错位、接口停更返回三年前的快照、
汇率源把方向取反。这类脏数据一旦写进 prices.json 就会污染资产曲线，
而且很难事后察觉。

四类规则
--------
1. **合法性**：价格为 0/负数/None/NaN → 拒绝；日期不合法或为未来 → 拒绝。
2. **新鲜度**：现价型数据源返回的日期必须贴近今天（拦截 crypto_js_spot
   那种"HTTP 200 但数据停在 2023 年"的情况）。
3. **连续性**：与上一交易日偏离超过阈值（普通 20% / 加密 50%）→ 标记
   SUSPECT，**不覆盖旧值**，写入 warnings。
4. **级联保护**：连续 N 个点都超阈值时，判定为真实跳变而非解析错误并放行，
   避免一次真实跳空把后续数据永久锁死。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Iterable, Sequence

from config import (
    DEVIATION_THRESHOLD_BY_MARKET,
    MAX_DIVIDEND_FUTURE_DAYS,
    MAX_SPOT_STALENESS_DAYS,
    PRICE_DEVIATION_THRESHOLD,
    SPOT_ONLY_SOURCES,
    SUSPECT_STREAK_TOLERANCE,
    USDCNY_SANE_RANGE,
)
from models import DividendEvent, FxSnapshot, PriceSnapshot
from providers.base import is_valid_date_str, today


class Verdict(str, Enum):
    """质量判定结果。"""

    ACCEPT = "ACCEPT"
    SUSPECT = "SUSPECT"
    REJECT = "REJECT"


@dataclass(slots=True)
class GateResult:
    """闸门对一批数据的处理结果。"""

    accepted: list = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    rejected_count: int = 0
    suspect_count: int = 0


class QualityGate:
    """对价格、分红、汇率执行质量校验。"""

    def __init__(self, reference_date: str | None = None) -> None:
        """初始化。

        Args:
            reference_date: 用作"今天"的基准日期，便于单测注入。
                为 None 时取当前 UTC 日期。
        """
        self._today = reference_date or today().strftime("%Y-%m-%d")

    # ================================================================ 价格
    def check_price(
        self,
        snapshot: PriceSnapshot,
        reference_price: float | None,
        market: str,
    ) -> tuple[Verdict, str]:
        """校验单条行情快照。

        Args:
            snapshot: 待校验快照。
            reference_price: 上一个已接受的价格，None 表示无参照。
            market: 市场类型，决定偏离阈值。

        Returns:
            (判定结果, 原因说明)。
        """
        # --- 规则 1：合法性 ---
        if snapshot.price is None:
            return Verdict.REJECT, "价格为空"
        if snapshot.price <= 0:
            return Verdict.REJECT, f"价格非正数({snapshot.price})"
        if not is_valid_date_str(snapshot.date):
            return Verdict.REJECT, f"日期不合法({snapshot.date})"
        if snapshot.date > self._today:
            return Verdict.REJECT, f"未来日期({snapshot.date})"

        # --- 规则 2：新鲜度（只针对现价型源）---
        if snapshot.source in SPOT_ONLY_SOURCES:
            age_days = _days_between(snapshot.date, self._today)
            if age_days > MAX_SPOT_STALENESS_DAYS:
                return (
                    Verdict.REJECT,
                    f"现价源数据陈旧({snapshot.date}，已 {age_days} 天未更新)",
                )

        # --- 规则 3：连续性 ---
        if reference_price and reference_price > 0:
            threshold = DEVIATION_THRESHOLD_BY_MARKET.get(
                market, PRICE_DEVIATION_THRESHOLD
            )
            deviation = abs(snapshot.price - reference_price) / reference_price
            if deviation > threshold:
                return (
                    Verdict.SUSPECT,
                    f"较上一价偏离 {deviation:.1%}（阈值 {threshold:.0%}，"
                    f"{reference_price} → {snapshot.price}）",
                )

        return Verdict.ACCEPT, ""

    def filter_prices(
        self,
        snapshots: Sequence[PriceSnapshot],
        known_prices: dict[str, float],
        market: str,
        instrument_id: str,
    ) -> GateResult:
        """按时间顺序批量校验行情。

        Args:
            snapshots: 本轮新抓到的快照。
            known_prices: 已有的 `{date: price}`，用于取得比较基准。
            market: 市场类型。
            instrument_id: 标的 ID，仅用于警告文案。

        Returns:
            GateResult，`accepted` 为通过校验的快照列表。
        """
        result = GateResult()
        ordered = sorted(snapshots, key=lambda s: s.date)

        # 基准价 = 已知序列中最后一个早于本批数据的价格
        reference = _latest_before(known_prices, ordered[0].date) if ordered else None
        suspect_streak = 0

        for snapshot in ordered:
            verdict, reason = self.check_price(snapshot, reference, market)

            if verdict is Verdict.REJECT:
                result.rejected_count += 1
                result.warnings.append(f"[{instrument_id}] 拒绝 {snapshot.date}：{reason}")
                continue

            if verdict is Verdict.SUSPECT:
                suspect_streak += 1
                # 级联保护：连续多个点都异常，说明是真实跳变而非解析错位
                if suspect_streak >= SUSPECT_STREAK_TOLERANCE:
                    result.warnings.append(
                        f"[{instrument_id}] {snapshot.date} 连续 {suspect_streak} 个点超阈值，"
                        f"判定为真实跳变并放行：{reason}"
                    )
                    result.accepted.append(snapshot)
                    reference = snapshot.price
                    suspect_streak = 0
                else:
                    result.suspect_count += 1
                    result.warnings.append(
                        f"[{instrument_id}] SUSPECT {snapshot.date}：{reason}（保留旧值，未覆盖）"
                    )
                continue

            suspect_streak = 0
            result.accepted.append(snapshot)
            reference = snapshot.price

        return result

    # ================================================================ 分红
    def check_dividend(self, event: DividendEvent) -> tuple[Verdict, str]:
        """校验单条分红事件。

        与价格不同，**分红允许未来日期** —— 已宣派未发放的分红正是本系统
        最有价值的数据（前端要据此做日历提醒与现金流预测）。因此这里只拦截
        超过 `MAX_DIVIDEND_FUTURE_DAYS` 的离谱日期。

        Args:
            event: 待校验事件。

        Returns:
            (判定结果, 原因说明)。
        """
        if event.currency not in {"CNY", "USD", "HKD"}:
            return Verdict.REJECT, f"不支持的币种({event.currency})"

        # 纯送转股（SCRIP）没有现金金额，0 是合法的
        if event.dividend_form != "SCRIP":
            if event.per_share_amount is None or event.per_share_amount <= 0:
                return Verdict.REJECT, f"每股金额非正数({event.per_share_amount})"

        dates = {
            "announceDate": event.announce_date,
            "recordDate": event.record_date,
            "exDate": event.ex_date,
            "payDate": event.pay_date,
        }
        present = {name: value for name, value in dates.items() if value}
        if not present:
            return Verdict.REJECT, "缺少全部日期字段"

        horizon = (
            datetime.strptime(self._today, "%Y-%m-%d").date()
            + timedelta(days=MAX_DIVIDEND_FUTURE_DAYS)
        ).strftime("%Y-%m-%d")

        for name, value in present.items():
            if not is_valid_date_str(value):
                return Verdict.REJECT, f"{name} 不合法({value})"
            if value > horizon:
                return Verdict.REJECT, f"{name} 超出合理区间({value})"

        if not event.source_key:
            return Verdict.REJECT, "缺少 sourceKey（无法去重）"

        return Verdict.ACCEPT, ""

    def filter_dividends(
        self, events: Sequence[DividendEvent], instrument_id: str
    ) -> GateResult:
        """批量校验分红事件。

        Args:
            events: 待校验事件。
            instrument_id: 标的 ID，用于警告文案。

        Returns:
            GateResult。
        """
        result = GateResult()
        for event in events:
            verdict, reason = self.check_dividend(event)
            if verdict is Verdict.ACCEPT:
                result.accepted.append(event)
            else:
                result.rejected_count += 1
                result.warnings.append(
                    f"[{instrument_id}] 拒绝分红 {event.source_key}：{reason}"
                )
        return result

    # ================================================================ 汇率
    def check_fx(self, snapshot: FxSnapshot) -> tuple[Verdict, str]:
        """校验单条汇率快照。

        Args:
            snapshot: 待校验快照。

        Returns:
            (判定结果, 原因说明)。
        """
        if not is_valid_date_str(snapshot.date):
            return Verdict.REJECT, f"日期不合法({snapshot.date})"
        if snapshot.date > self._today:
            return Verdict.REJECT, f"未来日期({snapshot.date})"
        if not snapshot.rates:
            return Verdict.REJECT, "汇率表为空"

        for pair, value in snapshot.rates.items():
            if value is None or value <= 0:
                return Verdict.REJECT, f"{pair} 非正数({value})"

        usd_cny = snapshot.rates.get("USDCNY")
        if usd_cny is not None:
            low, high = USDCNY_SANE_RANGE
            # 典型故障：源返回了反向汇率（0.147 而不是 6.8）
            if not low <= usd_cny <= high:
                return Verdict.REJECT, f"USDCNY 超出合理区间({usd_cny})，疑似方向取反"

        return Verdict.ACCEPT, ""

    def filter_fx(self, snapshots: Sequence[FxSnapshot]) -> GateResult:
        """批量校验汇率快照。

        Args:
            snapshots: 待校验快照。

        Returns:
            GateResult。
        """
        result = GateResult()
        for snapshot in snapshots:
            verdict, reason = self.check_fx(snapshot)
            if verdict is Verdict.ACCEPT:
                result.accepted.append(snapshot)
            else:
                result.rejected_count += 1
                result.warnings.append(f"[fx] 拒绝 {snapshot.date}：{reason}")
        return result


# ==================================================================== 工具
def _days_between(earlier: str, later: str) -> int:
    """计算两个 ISO 日期之间的天数。

    Args:
        earlier: 较早日期。
        later: 较晚日期。

    Returns:
        天数差；解析失败返回 0。
    """
    try:
        a = datetime.strptime(earlier, "%Y-%m-%d").date()
        b = datetime.strptime(later, "%Y-%m-%d").date()
    except ValueError:
        return 0
    return (b - a).days


def _latest_before(known_prices: dict[str, float], boundary: str) -> float | None:
    """取得早于 boundary 的最后一个已知价格。

    Args:
        known_prices: `{date: price}`。
        boundary: 边界日期（不含）。

    Returns:
        价格；无匹配返回 None。
    """
    candidates = [d for d in known_prices if d < boundary]
    if not candidates:
        return None
    return known_prices[max(candidates)]

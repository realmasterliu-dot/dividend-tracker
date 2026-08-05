"""数据模型：与 src/types/index.ts 严格一一对应的 dataclass。

约定：
- Python 侧用 snake_case，序列化时统一转 camelCase 以匹配 TS 契约。
- TS 中的可选字段（`foo?`）在值为 None 时**整个 key 省略**，而不是输出 null，
  这样前端 `foo ?? default` 与 `'foo' in obj` 两种写法都能正常工作。
- 前端计算引擎的推导字段（quantityAtRecord/grossAmount/... ）由管道输出占位值，
  管道只负责客观市场数据。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Literal

Currency = Literal["CNY", "USD", "HKD"]
DividendStatus = Literal[
    "PROPOSED", "APPROVED", "DECLARED", "EX_DIVIDEND", "PAID", "RECONCILED"
]
TaxBracket = Literal["LE1M", "M1_1Y", "GT1Y", "NONE"]
DividendForm = Literal["CASH", "SCRIP", "CASH_SCRIP"]
HealthStatus = Literal["GREEN", "YELLOW", "RED"]


@dataclass(slots=True)
class PriceSnapshot:
    """行情快照，对应 TS `PriceSnapshot`。"""

    instrument_id: str
    date: str
    price: float
    currency: Currency
    fx_rate: float = 1.0
    source: str = ""
    nav_date: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """序列化为前端契约的 camelCase 字典。"""
        out: dict[str, Any] = {
            "instrumentId": self.instrument_id,
            "date": self.date,
            "price": self.price,
            "currency": self.currency,
            "fxRate": self.fx_rate,
            "source": self.source,
        }
        if self.nav_date:
            out["navDate"] = self.nav_date
        return out

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "PriceSnapshot":
        """从缓存/输出 JSON 反序列化。"""
        return cls(
            instrument_id=str(raw["instrumentId"]),
            date=str(raw["date"]),
            price=float(raw["price"]),
            currency=raw.get("currency", "CNY"),
            fx_rate=float(raw.get("fxRate", 1.0)),
            source=str(raw.get("source", "")),
            nav_date=raw.get("navDate"),
        )

    @property
    def key(self) -> tuple[str, str]:
        """幂等主键：同一标的同一天只保留一条。"""
        return (self.instrument_id, self.date)


@dataclass(slots=True)
class FxSnapshot:
    """汇率快照，对应 TS `FxSnapshot`。"""

    date: str
    rates: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """序列化为前端契约字典。"""
        return {"date": self.date, "rates": self.rates}

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "FxSnapshot":
        """从缓存 JSON 反序列化。"""
        return cls(
            date=str(raw["date"]),
            rates={str(k): float(v) for k, v in (raw.get("rates") or {}).items()},
        )


@dataclass(slots=True)
class DividendEvent:
    """分红事件，对应 TS `DividendEvent`。

    推导字段（quantity_at_record / gross_amount / tax_* / net_amount / tax_bracket）
    固定输出占位值，由前端计算引擎依据用户持仓填充。
    """

    instrument_id: str
    per_share_amount: float
    currency: Currency
    source_key: str
    status: DividendStatus = "DECLARED"
    announce_date: str | None = None
    record_date: str | None = None
    ex_date: str | None = None
    pay_date: str | None = None
    pay_date_estimated: bool = True
    dividend_form: DividendForm = "CASH"
    is_special: bool | None = None
    is_estimate: bool | None = None
    manual: bool = False

    @property
    def id(self) -> str:
        """由 source_key 派生的稳定 ID —— 保证重复运行不产生新 ID。"""
        digest = hashlib.md5(self.source_key.encode("utf-8")).hexdigest()[:12]
        return f"div-{digest}"

    def to_dict(self) -> dict[str, Any]:
        """序列化为前端契约的 camelCase 字典。"""
        out: dict[str, Any] = {
            "id": self.id,
            "instrumentId": self.instrument_id,
            "status": self.status,
            "payDateEstimated": self.pay_date_estimated,
            "perShareAmount": self.per_share_amount,
            "currency": self.currency,
            # ---- 以下为前端推导字段，管道输出占位值 ----
            "quantityAtRecord": 0,
            "grossAmount": 0,
            "taxRateApplied": 0,
            "taxWithheld": 0,
            "contingentTax": 0,
            "netAmount": 0,
            "taxBracket": "NONE",
            # -------------------------------------------
            "dividendForm": self.dividend_form,
            "manual": self.manual,
            "sourceKey": self.source_key,
        }
        if self.announce_date:
            out["announceDate"] = self.announce_date
        if self.record_date:
            out["recordDate"] = self.record_date
        if self.ex_date:
            out["exDate"] = self.ex_date
        if self.pay_date:
            out["payDate"] = self.pay_date
        if self.is_special is not None:
            out["isSpecial"] = self.is_special
        if self.is_estimate is not None:
            out["isEstimate"] = self.is_estimate
        return out

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "DividendEvent":
        """从缓存 JSON 反序列化（推导字段直接丢弃，由前端重算）。"""
        return cls(
            instrument_id=str(raw["instrumentId"]),
            per_share_amount=float(raw.get("perShareAmount", 0.0)),
            currency=raw.get("currency", "CNY"),
            source_key=str(raw.get("sourceKey", "")),
            status=raw.get("status", "DECLARED"),
            announce_date=raw.get("announceDate"),
            record_date=raw.get("recordDate"),
            ex_date=raw.get("exDate"),
            pay_date=raw.get("payDate"),
            pay_date_estimated=bool(raw.get("payDateEstimated", True)),
            dividend_form=raw.get("dividendForm", "CASH"),
            is_special=raw.get("isSpecial"),
            is_estimate=raw.get("isEstimate"),
            manual=bool(raw.get("manual", False)),
        )


@dataclass(slots=True)
class SourceHealthEntry:
    """单个数据源的健康度，对应 TS `DataState.sourceHealth` 的 value。"""

    last_success: str = ""
    consecutive_failures: int = 0
    status: HealthStatus = "GREEN"

    def to_dict(self) -> dict[str, Any]:
        """序列化为前端契约字典（严格三字段，不掺实现细节）。"""
        return {
            "lastSuccess": self.last_success,
            "consecutiveFailures": self.consecutive_failures,
            "status": self.status,
        }


@dataclass(slots=True)
class PipelineMeta:
    """meta.json 结构。"""

    generated_at: str
    pipeline_version: str
    instrument_count: int
    warnings: list[str] = field(default_factory=list)
    duration_seconds: float = 0.0
    categories: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """序列化为 meta.json。"""
        return {
            "generatedAt": self.generated_at,
            "pipelineVersion": self.pipeline_version,
            "instrumentCount": self.instrument_count,
            "warnings": self.warnings,
            "durationSeconds": round(self.duration_seconds, 2),
            "categories": self.categories,
        }

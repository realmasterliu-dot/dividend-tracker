"""数据源 provider 包。

每个 provider 封装一类市场的行情/分红降级链，统一由 `ResilientFetcher` 驱动。
"""

from providers.base import (
    BaseProvider,
    ChainResult,
    HealthRegistry,
    ResilientFetcher,
    SourceAttempt,
    SourceCandidate,
    setup_logging,
)
from providers.cn_stock import CnStockProvider
from providers.crypto import CryptoProvider
from providers.fund import FundProvider
from providers.fx import FxProvider, FxResolver
from providers.gold import GoldProvider
from providers.hk_stock import HkStockProvider
from providers.us_stock import UsStockProvider

__all__ = [
    "BaseProvider",
    "ChainResult",
    "CnStockProvider",
    "CryptoProvider",
    "FundProvider",
    "FxProvider",
    "FxResolver",
    "GoldProvider",
    "HealthRegistry",
    "HkStockProvider",
    "ResilientFetcher",
    "SourceAttempt",
    "SourceCandidate",
    "UsStockProvider",
    "setup_logging",
]

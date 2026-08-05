"""管道全局配置：标的清单、数据源优先级、质量阈值、路径常量。

所有"魔法数字"集中在此，便于在 GitHub Actions 上通过环境变量覆盖而不改代码。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Literal

# ---------------------------------------------------------------- 类型别名
Market = Literal["A_SHARE", "HK", "US", "FUND", "CRYPTO", "GOLD"]
Currency = Literal["CNY", "USD", "HKD"]

# ---------------------------------------------------------------- 版本
PIPELINE_VERSION: Final[str] = "1.0.0"

# ---------------------------------------------------------------- 路径
# config.py 位于 <repo>/scripts/pipeline/config.py
PIPELINE_DIR: Final[Path] = Path(__file__).resolve().parent
SCRIPTS_DIR: Final[Path] = PIPELINE_DIR.parent
REPO_ROOT: Final[Path] = SCRIPTS_DIR.parent

OUTPUT_DIR: Final[Path] = Path(
    os.environ.get("PIPELINE_OUTPUT_DIR", REPO_ROOT / "public" / "data")
)
# cache/ 需要提交进仓库，供 GitHub Actions 增量复用（不要写进 .gitignore）
CACHE_DIR: Final[Path] = Path(
    os.environ.get("PIPELINE_CACHE_DIR", PIPELINE_DIR / "cache")
)
PRICE_CACHE_DIR: Final[Path] = CACHE_DIR / "prices"
DIVIDEND_CACHE_DIR: Final[Path] = CACHE_DIR / "dividends"
FX_CACHE_FILE: Final[Path] = CACHE_DIR / "fx.json"
# 熔断器内部状态。刻意与 source_health.json 分离：
# 后者要严格匹配前端 TS 契约，不能掺入 openUntil 等实现细节字段。
CIRCUIT_STATE_FILE: Final[Path] = CACHE_DIR / "_circuit_state.json"

# ---------------------------------------------------------------- 本位币
# 与 src/data/seed/settings.seed.ts 的 baseCurrency 保持一致
BASE_CURRENCY: Final[Currency] = "CNY"
# 需要维护的汇率对（写入 fx.json 的 rates 字典）
FX_PAIRS: Final[tuple[str, ...]] = ("USDCNY", "HKDCNY", "CNYUSD", "CNYHKD")


# ---------------------------------------------------------------- 标的配置
@dataclass(frozen=True)
class InstrumentConfig:
    """单个标的的抓取配置。

    Attributes:
        id: 与前端 `Instrument.id` 完全一致的主键。
        symbol: 展示用代码。
        name: 中文名称。
        market: 市场分类，决定使用哪个 provider。
        currency: 标的计价币种。
        fetch_symbol: 传给主数据源的代码（可能带市场前缀，如 `105.AAPL`）。
        alt_symbol: 传给备用数据源的代码（如新浪源用裸 `AAPL`）。
        dividend_eligible: 是否需要抓分红（BTC/黄金无分红，跳过以省时间）。
        note: 特殊说明，会写进 README 与运行日志。
    """

    id: str
    symbol: str
    name: str
    market: Market
    currency: Currency
    fetch_symbol: str
    alt_symbol: str = ""
    dividend_eligible: bool = True
    note: str = ""


# 与 src/data/seed/instruments.seed.ts 的 7 个种子标的一一对应
INSTRUMENTS: Final[list[InstrumentConfig]] = [
    InstrumentConfig(
        id="600519.SH",
        symbol="600519.SH",
        name="贵州茅台",
        market="A_SHARE",
        currency="CNY",
        fetch_symbol="600519",
    ),
    InstrumentConfig(
        id="000001.SZ",
        symbol="000001.SZ",
        name="平安银行",
        market="A_SHARE",
        currency="CNY",
        fetch_symbol="000001",
    ),
    InstrumentConfig(
        id="00700.HK",
        symbol="00700.HK",
        name="腾讯控股",
        market="HK",
        currency="HKD",
        fetch_symbol="00700",
    ),
    InstrumentConfig(
        id="AAPL",
        symbol="AAPL",
        name="Apple Inc.",
        market="US",
        currency="USD",
        # 东财美股必须带市场前缀：105=NASDAQ, 106=NYSE
        fetch_symbol="105.AAPL",
        alt_symbol="AAPL",
    ),
    InstrumentConfig(
        id="110011",
        symbol="110011",
        name="易方达优质精选混合",
        market="FUND",
        currency="CNY",
        fetch_symbol="110011",
    ),
    InstrumentConfig(
        id="BTC",
        symbol="BTC",
        name="Bitcoin",
        market="CRYPTO",
        currency="USD",
        fetch_symbol="BTC",
        alt_symbol="BTCUSDT",
        dividend_eligible=False,
        note="境内网络下各大 CEX 均被墙，仅 gold-api 可用且只有现价（无历史）",
    ),
    InstrumentConfig(
        id="Au99.99",
        symbol="Au99.99",
        name="上金所黄金 Au99.99",
        market="GOLD",
        currency="CNY",
        # 上金所官网 SSL 握手失败，改用华安黄金 ETF 作为代理
        fetch_symbol="518880",
        dividend_eligible=False,
        note="上金所 SSL 不可用，使用黄金 ETF 518880 折算为 CNY/克（近似代理）",
    ),
]

INSTRUMENT_BY_ID: Final[dict[str, InstrumentConfig]] = {i.id: i for i in INSTRUMENTS}

# ---------------------------------------------------------------- 抓取窗口
# 冷启动（cache 为空）时的回填起点，与前端 seed 的 PRICE_START 对齐
COLD_START_DATE: Final[str] = os.environ.get("PIPELINE_COLD_START", "2023-01-01")
# 日常增量窗口：7 天足以覆盖春节等长假造成的缺口
DEFAULT_LOOKBACK_DAYS: Final[int] = int(os.environ.get("PIPELINE_LOOKBACK_DAYS", "7"))

# ---------------------------------------------------------------- 弹性策略
DEFAULT_TIMEOUT_S: Final[float] = float(os.environ.get("PIPELINE_TIMEOUT", "20"))
DEFAULT_RETRIES: Final[int] = int(os.environ.get("PIPELINE_RETRIES", "3"))
# 指数退避基数：第 n 次重试等待 BACKOFF_BASE * 2**n 秒（外加抖动）
BACKOFF_BASE_S: Final[float] = float(os.environ.get("PIPELINE_BACKOFF", "1.0"))
BACKOFF_MAX_S: Final[float] = 15.0
# 熔断阈值：连续失败 N 次后在冷却期内直接跳过该源
CIRCUIT_BREAKER_THRESHOLD: Final[int] = int(os.environ.get("PIPELINE_CIRCUIT_N", "3"))
CIRCUIT_COOLDOWN_S: Final[float] = float(
    os.environ.get("PIPELINE_CIRCUIT_COOLDOWN", str(6 * 3600))
)

# source_health 状态分级（consecutiveFailures → status）
HEALTH_YELLOW_AT: Final[int] = 1
HEALTH_RED_AT: Final[int] = CIRCUIT_BREAKER_THRESHOLD

# ---------------------------------------------------------------- 质量闸门
# 相邻交易日价格偏离超过该比例 → 标记 SUSPECT（不覆盖旧值）
PRICE_DEVIATION_THRESHOLD: Final[float] = 0.20
# 加密货币波动天然更大，单独放宽
CRYPTO_DEVIATION_THRESHOLD: Final[float] = 0.50
DEVIATION_THRESHOLD_BY_MARKET: Final[dict[str, float]] = {
    "CRYPTO": CRYPTO_DEVIATION_THRESHOLD,
}
# 现价型数据源（只返回"最新值"而无日期序列）允许的最大陈旧天数。
# 关键防线：ak.crypto_js_spot 实测返回 2023-10-02 的数据但 HTTP 成功，
# 若不做新鲜度校验会把三年前的价格当作今日价写入，污染整条资产曲线。
MAX_SPOT_STALENESS_DAYS: Final[int] = 5
# 只提供"当前价"的源（其 source 标签）。这些源返回的数据日期必须贴近今天，
# 否则说明上游已停更。历史序列型的源（日K）不受此规则约束。
SPOT_ONLY_SOURCES: Final[frozenset[str]] = frozenset(
    {
        "gold-api·现价",
        "Coinbase·现价",
        "CoinGecko·现价",
        "akshare·crypto_js",
        "gold-api·XAU折算(代理)",
    }
)
# 连续多少个点都判定为 SUSPECT 时，认为这是真实的价格跳变而非解析错位。
# 防止一次真实的大幅跳空导致后续所有数据被永久拒绝（级联封锁）。
SUSPECT_STREAK_TOLERANCE: Final[int] = 3
# USD/CNY 的合理区间。用于识别"源把汇率取反了"这类错误（返回 0.147 而非 6.8）。
USDCNY_SANE_RANGE: Final[tuple[float, float]] = (2.0, 15.0)
# 合法日期下界（早于此视为解析错位）。
# 注意：不能设成 1990。实测 Nasdaq 官方接口返回的 AAPL 派息历史可回溯到 1987-11-17
# （Apple 1987 年首次派息），设成 1990 会把 5 条真实历史分红当成"解析错位"误杀。
# 取 1980 作为下界：早于 1980 的日期在本项目的标的范围内一定是脏数据。
MIN_VALID_DATE: Final[str] = "1980-01-01"
# 分红事件允许的未来天数：已宣派未发放的分红是正常且有价值的数据，
# 不能像价格那样一律拒绝未来日期，但超过 400 天基本可判定为解析错误。
MAX_DIVIDEND_FUTURE_DAYS: Final[int] = 400

# 分红缓存的 schema 版本。
# 分红缓存是「按 sourceKey 累积、只增不删」的，这样才能在数据源临时降级/少返
# 记录时不丢历史。代价是：一旦 sourceKey 的构成规则发生变化，旧键不会被清理，
# 同一笔分红会以新旧两个键并存，导致重复。
# 因此**任何改动 sourceKey 组成方式的提交都必须把这个版本号 +1**，
# 管道检测到版本不一致时会重建该缓存（保留用户手工录入的条目）。
#   v1 -> v2: 港股 sourceKey 增加「分配类型」字段，修复腾讯 FY2008 同一除净日
#             两笔派息（年度 HK$0.25 + 特别 HK$0.10）互相覆盖导致丢数据的问题。
DIVIDEND_CACHE_SCHEMA: Final[int] = 2

# ---------------------------------------------------------------- 业务常量
# A股「方案进度」→ 前端 DividendStatus 的基础映射。
# 实测 stock_fhps_detail_em 出现过的取值：实施分配 / 预披露。
# 其余取值来自东财公开口径，做前缀兜底匹配。
A_SHARE_PROGRESS_MAP: Final[dict[str, str]] = {
    "预披露": "PROPOSED",
    "董事会预案": "PROPOSED",
    "预案": "PROPOSED",
    "股东大会预案": "PROPOSED",
    "股东大会通过": "APPROVED",
    "股东大会决议": "APPROVED",
    "实施分配": "DECLARED",
    "实施方案": "DECLARED",
    "分红实施": "DECLARED",
}
# 命中即整行跳过（不分配 / 终止）
A_SHARE_SKIP_KEYWORDS: Final[tuple[str, ...]] = ("不分配", "不分红", "终止", "取消")
# A股现金分红比例是「每 10 股」口径，需除以 10 得到每股金额
A_SHARE_DIVIDEND_PER_SHARES: Final[float] = 10.0

# 港股：实测 stock_hk_dividend_payout_em 的「发放日」列 100% 为空，
# 因此无法判定 PAID。用除净日 + 该滞后天数做保守推断。
HK_PAY_LAG_DAYS: Final[int] = 45

# 黄金 ETF → CNY/克 的换算系数。
# 518880 每份额约对应 0.01 克黄金，故 ×100。这是近似值：
# ETF 份额会因管理费逐年缓慢损耗，实测与 XAU 折算价约有 5% 偏差。
GOLD_ETF_TO_GRAM_FACTOR: Final[float] = 100.0
# 1 金衡盎司 = 31.1034768 克（XAU 备源折算用）
TROY_OUNCE_IN_GRAMS: Final[float] = 31.1034768

# ---------------------------------------------------------------- HTTP
HTTP_HEADERS: Final[dict[str, str]] = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

# ---------------------------------------------------------------- 数据源端点
FRANKFURTER_LATEST: Final[str] = "https://api.frankfurter.dev/v1/latest"
FRANKFURTER_RANGE: Final[str] = "https://api.frankfurter.dev/v1/{start}..{end}"
ER_API_LATEST: Final[str] = "https://open.er-api.com/v6/latest/{base}"
GOLD_API_PRICE: Final[str] = "https://api.gold-api.com/price/{symbol}"
NASDAQ_DIVIDENDS: Final[str] = (
    "https://api.nasdaq.com/api/quote/{symbol}/dividends?assetclass=stocks"
)
BINANCE_KLINES: Final[str] = "https://api.binance.com/api/v3/klines"
COINBASE_SPOT: Final[str] = "https://api.coinbase.com/v2/prices/{pair}/spot"
COINGECKO_SPOT: Final[str] = "https://api.coingecko.com/api/v3/simple/price"

# 可抓取的数据类别（--only 的合法取值）
VALID_CATEGORIES: Final[tuple[str, ...]] = ("prices", "dividends", "fx")

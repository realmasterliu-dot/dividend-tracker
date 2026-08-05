"""Provider 基础设施：弹性抓取链、熔断器、健康度登记、解析工具。

设计要点
--------
1. **降级链**：每类数据由一组有序 `SourceCandidate` 组成，主源失败自动切备源。
2. **绝不崩溃**：任何单源异常都被捕获并降级为警告，`ResilientFetcher` 永远返回
   `ChainResult`，由调用方决定如何处理空结果。
3. **熔断**：连续失败达阈值后，在冷却期内直接跳过该源，避免每天浪费几十秒去
   重试一个已被墙的域名（境内环境下 CEX 类源就是这种情况）。
4. **tqdm 静音**：akshare 内部用 tqdm 写进度条，会把 GitHub Actions 日志刷爆，
   统一用 `silence_output()` 包裹。
"""

from __future__ import annotations

import contextlib
import io
import json
import logging
import math
import os
import random
import re
import sys
import time
from abc import ABC
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Generic, Iterable, Sequence, TypeVar

# 必须在 akshare / tqdm 被任何模块 import 之前设置，新版 tqdm 会读取该变量
os.environ.setdefault("TQDM_DISABLE", "1")

import pandas as pd
import requests

from config import (
    BACKOFF_BASE_S,
    BACKOFF_MAX_S,
    CIRCUIT_COOLDOWN_S,
    CIRCUIT_BREAKER_THRESHOLD,
    CIRCUIT_STATE_FILE,
    DEFAULT_RETRIES,
    DEFAULT_TIMEOUT_S,
    HEALTH_RED_AT,
    HEALTH_YELLOW_AT,
    HTTP_HEADERS,
    MIN_VALID_DATE,
)
from models import SourceHealthEntry

T = TypeVar("T")

LOG = logging.getLogger("pipeline")

# 连接层面的错误（被墙 / DNS 失败 / 读超时）几乎不可能靠重试恢复。
# 实测教训：Binance 在境内每次 ReadTimeout 都要等满超时，默认重试 3 次
# 就是 60 秒 —— 占了整轮 81 秒的四分之三。这类错误只试一次。
_FAST_FAIL_TYPES: frozenset[str] = frozenset(
    {
        "SSLError",
        "SSLZeroReturnError",
        "ConnectionError",
        "ConnectTimeout",
        "ReadTimeout",
        "Timeout",
        "ProxyError",
        "NewConnectionError",
        "MaxRetryError",
    }
)
_FAST_FAIL_ATTEMPTS = 1


# ==================================================================== 日志
def setup_logging(verbose: bool = False) -> logging.Logger:
    """配置结构化日志。

    刻意绑定到导入时的 `sys.stderr` 对象，这样 `silence_output()` 里的
    `redirect_stderr` 不会连我们自己的日志一起吞掉。

    Args:
        verbose: 是否输出 DEBUG 级别日志。

    Returns:
        配置好的 pipeline logger。
    """
    logger = logging.getLogger("pipeline")
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    logger.handlers.clear()
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-5s %(message)s", "%H:%M:%S")
    )
    logger.addHandler(handler)
    logger.propagate = False
    return logger


@contextlib.contextmanager
def silence_output():
    """吞掉第三方库（akshare/tqdm）写向 stdout/stderr 的噪音。

    Yields:
        None。退出时自动恢复标准流。
    """
    buf_out, buf_err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(buf_out), contextlib.redirect_stderr(buf_err):
        yield


# ==================================================================== 解析工具
def today() -> date:
    """返回当前 UTC 日期（Actions runner 与本地统一口径）。"""
    return datetime.now(timezone.utc).date()


def now_iso() -> str:
    """返回 ISO-8601 UTC 时间戳字符串。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_iso_date(value: Any) -> str | None:
    """把 akshare / JSON 里五花八门的日期值统一成 `yyyy-mm-dd`。

    实测需要兼容：`datetime.date`、`pandas.Timestamp`、`NaT`、`nan`、
    `'2026/05/19'`、`'2026-05-19'`、`'20260519'`。

    Args:
        value: 任意来源的日期值。

    Returns:
        ISO 日期字符串；无法解析或为空则返回 None。
    """
    if value is None:
        return None
    # NaT / nan 必须在 isinstance 判断之前处理（NaT 也是 datetime 子类实例）
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass

    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")

    text = str(value).strip()
    if not text or text.lower() in {"nan", "nat", "none", "-", "--"}:
        return None
    text = text.replace("/", "-")
    # 纯数字形式 20260519
    if re.fullmatch(r"\d{8}", text):
        text = f"{text[:4]}-{text[4:6]}-{text[6:]}"
    match = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if not match:
        return None
    year, month, day = (int(g) for g in match.groups())
    try:
        return date(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return None


def parse_us_date(value: Any) -> str | None:
    """解析美式 `MM/DD/YYYY` 日期（Nasdaq 接口使用该格式）。

    Args:
        value: 形如 `'08/10/2026'` 的字符串。

    Returns:
        ISO 日期字符串；不合法返回 None。
    """
    if value is None:
        return None
    text = str(value).strip()
    match = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", text)
    if not match:
        # 有些行是 'N/A'，回落到通用解析
        return to_iso_date(text)
    month, day, year = (int(g) for g in match.groups())
    try:
        return date(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return None


def safe_float(value: Any) -> float | None:
    """把任意值安全转成 float。

    Args:
        value: 待转换值，可能是 nan / None / 带符号的字符串。

    Returns:
        float 值；无法转换或为 NaN/Inf 时返回 None。
    """
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (int, float)):
        result = float(value)
    else:
        cleaned = re.sub(r"[^\d.\-eE+]", "", str(value))
        if not cleaned or cleaned in {"-", ".", "-."}:
            return None
        try:
            result = float(cleaned)
        except ValueError:
            return None
    if math.isnan(result) or math.isinf(result):
        return None
    return result


def is_valid_date_str(value: str | None) -> bool:
    """判断 ISO 日期字符串是否在合理区间内（防解析错位）。

    Args:
        value: ISO 日期字符串。

    Returns:
        合法返回 True。
    """
    if not value:
        return False
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return False
    return parsed >= datetime.strptime(MIN_VALID_DATE, "%Y-%m-%d").date()


# ==================================================================== HTTP
_SESSION: requests.Session | None = None


def http_session() -> requests.Session:
    """返回进程级共享的 requests Session（复用 TCP 连接）。"""
    global _SESSION
    if _SESSION is None:
        _SESSION = requests.Session()
        _SESSION.headers.update(HTTP_HEADERS)
    return _SESSION


def http_get_json(
    url: str,
    params: dict[str, Any] | None = None,
    timeout: float = DEFAULT_TIMEOUT_S,
) -> Any:
    """GET 一个 JSON 接口并返回解析结果。

    Args:
        url: 完整 URL。
        params: 查询参数。
        timeout: 超时秒数。

    Returns:
        解析后的 JSON 对象。

    Raises:
        requests.HTTPError: 非 2xx 响应。
        ValueError: 响应体不是合法 JSON。
    """
    response = http_session().get(url, params=params, timeout=timeout)
    response.raise_for_status()
    return response.json()


# ==================================================================== 抓取结果
@dataclass(slots=True)
class SourceAttempt:
    """单次数据源调用的记录（用于日志与 --probe 报告）。"""

    source: str
    ok: bool
    elapsed_s: float = 0.0
    rows: int = 0
    error: str = ""
    #: 异常类名。用精确类型判定是否快速失败，比在错误文案里做子串匹配可靠。
    error_type: str = ""
    skipped: bool = False

    def describe(self) -> str:
        """生成人类可读的一行摘要。"""
        if self.skipped:
            return f"SKIP  {self.source} (熔断冷却中)"
        if self.ok:
            return f"OK    {self.source}  {self.elapsed_s:.2f}s  rows={self.rows}"
        return f"FAIL  {self.source}  {self.elapsed_s:.2f}s  {self.error}"


@dataclass(slots=True)
class SourceCandidate(Generic[T]):
    """降级链中的一个候选源。

    Attributes:
        name: 稳定的源标识，用作 source_health 的 key。
        fn: 无参调用，返回数据或抛异常。
        allow_empty: 返回空集合是否算成功。
            例如 `fund_fh_em` 里 110011 确实没有任何分红记录，
            这是合法的"空"而非失败，不应触发降级。
        label: 写入 PriceSnapshot.source 的展示名。
    """

    name: str
    fn: Callable[[], T]
    allow_empty: bool = False
    label: str = ""

    def display(self) -> str:
        """返回展示名（未设置则回落到 name）。"""
        return self.label or self.name


@dataclass(slots=True)
class ChainResult(Generic[T]):
    """一条降级链的执行结果。"""

    value: T | None = None
    source_used: str = ""
    attempts: list[SourceAttempt] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        """是否有任一源成功返回。"""
        return self.value is not None

    @property
    def error_summary(self) -> str:
        """把所有失败原因拼成一行，用于 warnings。"""
        parts = [
            f"{a.source}({a.error or 'skipped'})"
            for a in self.attempts
            if not a.ok
        ]
        return "; ".join(parts)


# ==================================================================== 熔断/健康度
class HealthRegistry:
    """数据源健康度与熔断状态的持久化登记处。

    - 对外输出 `source_health.json`，严格匹配前端 TS 契约的三字段。
    - 熔断细节（open_until）单独存 `_circuit_state.json`，避免污染契约。
    """

    def __init__(
        self,
        state_file: Path = CIRCUIT_STATE_FILE,
        threshold: int = CIRCUIT_BREAKER_THRESHOLD,
        cooldown_s: float = CIRCUIT_COOLDOWN_S,
    ) -> None:
        """初始化并从磁盘载入历史状态。

        Args:
            state_file: 内部状态文件路径。
            threshold: 触发熔断的连续失败次数。
            cooldown_s: 熔断冷却秒数。
        """
        self._state_file = state_file
        self._threshold = threshold
        self._cooldown_s = cooldown_s
        self._state: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        """从磁盘读取上一轮的健康状态（文件损坏时静默重置）。"""
        if not self._state_file.exists():
            return
        try:
            raw = json.loads(self._state_file.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                self._state = raw
        except (json.JSONDecodeError, OSError) as exc:
            LOG.warning("熔断状态文件损坏，已重置: %s", exc)
            self._state = {}

    def _entry(self, source: str) -> dict[str, Any]:
        """取得（或创建）某个源的状态记录。"""
        return self._state.setdefault(
            source,
            {"lastSuccess": "", "consecutiveFailures": 0, "openUntil": 0.0},
        )

    def is_open(self, source: str) -> bool:
        """判断熔断器是否处于打开状态（应跳过该源）。

        Args:
            source: 源标识。

        Returns:
            True 表示仍在冷却期内，应跳过。
        """
        entry = self._entry(source)
        return float(entry.get("openUntil", 0.0)) > time.time()

    def record_success(self, source: str) -> None:
        """记录一次成功，清零失败计数并关闭熔断。"""
        entry = self._entry(source)
        entry["lastSuccess"] = now_iso()
        entry["consecutiveFailures"] = 0
        entry["openUntil"] = 0.0

    def record_failure(self, source: str) -> None:
        """记录一次失败，达到阈值则打开熔断器。"""
        entry = self._entry(source)
        entry["consecutiveFailures"] = int(entry.get("consecutiveFailures", 0)) + 1
        if entry["consecutiveFailures"] >= self._threshold:
            entry["openUntil"] = time.time() + self._cooldown_s

    def to_contract(self) -> dict[str, dict[str, Any]]:
        """导出为前端 `sourceHealth` 契约结构。

        Returns:
            `{source: {lastSuccess, consecutiveFailures, status}}`。
        """
        out: dict[str, dict[str, Any]] = {}
        for source, entry in sorted(self._state.items()):
            failures = int(entry.get("consecutiveFailures", 0))
            if failures >= HEALTH_RED_AT:
                status = "RED"
            elif failures >= HEALTH_YELLOW_AT:
                status = "YELLOW"
            else:
                status = "GREEN"
            out[source] = SourceHealthEntry(
                last_success=str(entry.get("lastSuccess", "")),
                consecutive_failures=failures,
                status=status,  # type: ignore[arg-type]
            ).to_dict()
        return out

    def save(self) -> None:
        """把内部状态写回磁盘。"""
        self._state_file.parent.mkdir(parents=True, exist_ok=True)
        self._state_file.write_text(
            json.dumps(self._state, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    def degraded_sources(self) -> list[str]:
        """列出当前处于 RED 的源，用于汇总 warnings。"""
        return [
            name
            for name, entry in sorted(self._state.items())
            if int(entry.get("consecutiveFailures", 0)) >= HEALTH_RED_AT
        ]


# ==================================================================== 弹性抓取
class ResilientFetcher:
    """按降级链执行抓取，内建重试、退避、熔断与健康度记录。"""

    def __init__(
        self,
        health: HealthRegistry,
        retries: int = DEFAULT_RETRIES,
        backoff_base_s: float = BACKOFF_BASE_S,
    ) -> None:
        """初始化抓取器。

        Args:
            health: 健康度登记处。
            retries: 每个源的最大尝试次数。
            backoff_base_s: 指数退避基数秒。
        """
        self.health = health
        self.retries = max(1, retries)
        self.backoff_base_s = backoff_base_s

    def _is_empty(self, value: Any) -> bool:
        """判断返回值是否为"空结果"。"""
        if value is None:
            return True
        if isinstance(value, pd.DataFrame):
            return value.empty
        if isinstance(value, (list, tuple, dict, set, str)):
            return len(value) == 0
        return False

    def _attempt_once(self, candidate: SourceCandidate[T]) -> tuple[T | None, SourceAttempt]:
        """执行单次调用并计时。

        Args:
            candidate: 候选源。

        Returns:
            (返回值或 None, 本次尝试记录)。
        """
        start = time.perf_counter()
        try:
            with silence_output():
                value = candidate.fn()
            elapsed = time.perf_counter() - start
            if self._is_empty(value) and not candidate.allow_empty:
                return None, SourceAttempt(
                    source=candidate.name,
                    ok=False,
                    elapsed_s=elapsed,
                    error="返回空结果",
                )
            rows = len(value) if hasattr(value, "__len__") else 1  # type: ignore[arg-type]
            return value, SourceAttempt(
                source=candidate.name, ok=True, elapsed_s=elapsed, rows=rows
            )
        except Exception as exc:  # noqa: BLE001 — 管道绝不能因单源异常中断
            elapsed = time.perf_counter() - start
            message = f"{type(exc).__name__}: {str(exc)[:160]}"
            return None, SourceAttempt(
                source=candidate.name,
                ok=False,
                elapsed_s=elapsed,
                error=message,
                error_type=type(exc).__name__,
            )

    def _max_attempts_for(self, error_type: str) -> int:
        """连接类错误快速失败，其余走完整重试。

        Args:
            error_type: 异常类名。

        Returns:
            该错误类型下允许的最大尝试次数。
        """
        if error_type in _FAST_FAIL_TYPES:
            return _FAST_FAIL_ATTEMPTS
        return self.retries

    def run(
        self, chain_name: str, candidates: Sequence[SourceCandidate[T]]
    ) -> ChainResult[T]:
        """依次尝试降级链中的各个源，返回第一个成功结果。

        Args:
            chain_name: 链名称，仅用于日志。
            candidates: 有序候选源列表，越靠前优先级越高。

        Returns:
            ChainResult；全部失败时 `value is None`，但**不会抛异常**。
        """
        result: ChainResult[T] = ChainResult()
        for candidate in candidates:
            if self.health.is_open(candidate.name):
                attempt = SourceAttempt(source=candidate.name, ok=False, skipped=True)
                result.attempts.append(attempt)
                LOG.debug("[%s] %s", chain_name, attempt.describe())
                continue

            # 必须用 while 而不是 for range(...)：range 在进入循环时就把次数固化了，
            # 之后再收敛 max_attempts 并不会缩短循环。实测这会让 binance 这类
            # 在境内必然超时的源仍然重试满 3 次（3×20s ReadTimeout），
            # 白白浪费 40s。日志里表现为诡异的「第 2/1 次」。
            max_attempts = self.retries
            attempt_no = 0
            while attempt_no < max_attempts:
                attempt_no += 1
                value, attempt = self._attempt_once(candidate)
                result.attempts.append(attempt)

                if attempt.ok:
                    LOG.info("[%s] %s", chain_name, attempt.describe())
                    self.health.record_success(candidate.name)
                    result.value = value
                    result.source_used = candidate.display()
                    return result

                # 第一次失败后才知道异常类型，据此收敛重试次数
                max_attempts = min(
                    max_attempts, self._max_attempts_for(attempt.error_type)
                )
                LOG.debug(
                    "[%s] %s (第 %d/%d 次)",
                    chain_name,
                    attempt.describe(),
                    attempt_no,
                    max_attempts,
                )
                if attempt_no < max_attempts:
                    delay = min(
                        self.backoff_base_s * (2 ** (attempt_no - 1)), BACKOFF_MAX_S
                    )
                    time.sleep(delay + random.uniform(0, 0.3))

            LOG.warning(
                "[%s] 源 %s 已耗尽重试，降级到下一个", chain_name, candidate.name
            )
            self.health.record_failure(candidate.name)

        LOG.error("[%s] 全部数据源失败: %s", chain_name, result.error_summary)
        return result

    def probe(
        self, chain_name: str, candidates: Sequence[SourceCandidate[T]]
    ) -> list[SourceAttempt]:
        """探测模式：逐个测试所有源（不重试、不短路、不写数据）。

        用于在 GitHub Actions 境外 runner 上实测各源真实连通性。

        Args:
            chain_name: 链名称。
            candidates: 候选源列表。

        Returns:
            每个源各一条尝试记录。
        """
        attempts: list[SourceAttempt] = []
        for candidate in candidates:
            _, attempt = self._attempt_once(candidate)
            attempts.append(attempt)
            LOG.info("[probe:%s] %s", chain_name, attempt.describe())
        return attempts


# ==================================================================== Provider 基类
class BaseProvider(ABC):
    """所有 provider 的抽象基类。

    子类通过实现 `price_candidates` / `dividend_candidates` 来声明降级链，
    抓取与容错逻辑统一由 `ResilientFetcher` 承担。
    """

    #: provider 标识，用于日志
    name: str = "base"

    def __init__(self, fetcher: ResilientFetcher) -> None:
        """注入抓取器。

        Args:
            fetcher: 共享的弹性抓取器实例。
        """
        self.fetcher = fetcher

    def price_candidates(
        self, instrument: Any, start: str, end: str
    ) -> list[SourceCandidate[list[Any]]]:
        """返回行情降级链。默认无源。

        Args:
            instrument: InstrumentConfig。
            start: 起始日期 `yyyy-mm-dd`。
            end: 结束日期 `yyyy-mm-dd`。

        Returns:
            候选源列表。
        """
        return []

    def dividend_candidates(
        self, instrument: Any
    ) -> list[SourceCandidate[list[Any]]]:
        """返回分红降级链。默认无源（加密/黄金等无分红标的）。

        Args:
            instrument: InstrumentConfig。

        Returns:
            候选源列表。
        """
        return []

    def fetch_prices(self, instrument: Any, start: str, end: str) -> ChainResult[list[Any]]:
        """抓取行情。

        Args:
            instrument: InstrumentConfig。
            start: 起始日期。
            end: 结束日期。

        Returns:
            ChainResult，value 为 PriceSnapshot 列表。
        """
        candidates = self.price_candidates(instrument, start, end)
        if not candidates:
            return ChainResult(value=[])
        return self.fetcher.run(f"prices:{instrument.id}", candidates)

    def fetch_dividends(self, instrument: Any) -> ChainResult[list[Any]]:
        """抓取分红。

        Args:
            instrument: InstrumentConfig。

        Returns:
            ChainResult，value 为 DividendEvent 列表。
        """
        candidates = self.dividend_candidates(instrument)
        if not candidates:
            return ChainResult(value=[])
        return self.fetcher.run(f"dividends:{instrument.id}", candidates)


def compact_date(iso_date: str) -> str:
    """把 `yyyy-mm-dd` 转成 akshare 要求的 `yyyymmdd`。

    Args:
        iso_date: ISO 日期字符串。

    Returns:
        紧凑日期字符串。
    """
    return iso_date.replace("-", "")


def daterange_days(start: str, end: str) -> int:
    """计算两个 ISO 日期之间的天数差。

    Args:
        start: 起始日期。
        end: 结束日期。

    Returns:
        天数差（end - start）；解析失败返回 0。
    """
    try:
        a = datetime.strptime(start, "%Y-%m-%d").date()
        b = datetime.strptime(end, "%Y-%m-%d").date()
    except ValueError:
        return 0
    return (b - a).days

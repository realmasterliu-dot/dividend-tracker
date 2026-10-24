import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  AppSettings,
  DataState,
  DividendEvent,
  Instrument,
  InvestmentPlan,
  Notification,
  Transaction,
} from '@/types';
import {
  downloadLedgerBackup,
  hasPersonalSlices,
  loadPersonalData,
  mergeImportedSlices,
  parseLedgerBackup,
  PersonalDataBundle,
} from '@/data/personalData';
import {
  applyMarketData,
  loadMarketData,
  MarketDataBundle,
  mergeDividends,
  stripUserEdits,
} from '@/data/realData';
import { uid } from '@/lib/clock';
import { useSettings } from './SettingsContext';
import { useAuth } from './AuthContext';
import { useLocalStorage } from './useLocalStorage';
import type { CloudLedgerSnapshot, LedgerPayload } from '@/data/cloud/types';
import { CloudSyncJournal } from '@/data/cloud/journal';
import {
  canonicalizeLedgerPayload,
  decideHydration,
  ledgerFingerprint,
  mergeLedgerPayloads,
  mergeLedgerPayloadsThreeWay,
  type SyncOutboxEntry,
} from '@/data/cloud/sync';
import { fxOn } from '@/lib/calc/fx';

/**
 * DataStore（architecture.md §5.2）
 * useReducer + 自动持久化；所有业务变更经 actions，乐观更新 + 级联重算。
 *
 * 数据分层：
 * - 个人数据只保存在本机；登录 CloudBase 后同步到当前用户的私有账本。
 * - public/data/holdings.json 仅作为显式导入/导出兼容格式，启动时绝不自动读取。
 * - 市场数据（prices/fx/dividends/sourceHealth）→ 每次启动从 public/data 真实管道重新加载，
 *   既避免旧缓存覆盖真实行情，也避免 5MB 配额被上万条行情撑爆。
 */

/** ★v2：真实数据接入，schema 与持久化范围均变更，旧版 v1 种子缓存直接作废 */
const STORAGE_KEY = 'dt:state:v2';
const LEGACY_STORAGE_KEYS = ['dt:state:v1'];
const LAST_CLOUD_USER_KEY = 'dt:cloud-user:v1';

/**
 * Anonymous records are a separate ledger head, not a stale copy of the owner's
 * cloud ledger. Preserve all distinct records on login; when an unlikely ID
 * collision occurs, the established owner ledger wins.
 */
export function mergeAnonymousLedgerForLogin(
  ownerLedger: LedgerPayload,
  anonymousLedger: LedgerPayload,
): LedgerPayload {
  const ownerHasData =
    ownerLedger.instruments.length > 0 ||
    ownerLedger.transactions.length > 0 ||
    ownerLedger.plans.length > 0 ||
    ownerLedger.dividends.length > 0;
  if (!ownerHasData) return canonicalizeLedgerPayload(anonymousLedger);
  return mergeLedgerPayloads(ownerLedger, anonymousLedger, {
    localRevision: 1,
    remoteRevision: 0,
    prefer: 'local',
  }).payload;
}

function isCloudSyncConflict(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    ((cause as { code?: unknown }).code === 'SYNC_CONFLICT' ||
      (cause as { name?: unknown }).name === 'CloudSyncConflictError')
  );
}

function cloudErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** 持久化载荷：剔除体积最大且每次都会重新拉取的行情/汇率 */
export type PersistedDataState = Omit<DataState, 'prices' | 'fx'>;

export type DataAction =
  | { type: 'ADD_TRANSACTION'; payload: Transaction }
  | { type: 'UPDATE_TRANSACTION'; payload: { id: string; patch: Partial<Transaction> } }
  | { type: 'DELETE_TRANSACTION'; payload: { id: string } }
  | { type: 'CONFIRM_PENDING'; payload: { id: string; actualQuantity?: number } }
  | { type: 'VOID_PENDING'; payload: { ids: string[] } }
  | { type: 'UPSERT_DIVIDEND'; payload: DividendEvent }
  | { type: 'BACKFILL_DIVIDEND'; payload: { id: string; actualReceived: number } }
  | { type: 'OVERRIDE_TAX_WITHHELD'; payload: { id: string; amount: number } }
  | { type: 'ADD_NOTIFICATION'; payload: Notification }
  | { type: 'MARK_NOTIFICATION_READ'; payload: { id: string } }
  | { type: 'MARK_ALL_NOTIFICATIONS_READ' }
  | { type: 'UPSERT_PLAN'; payload: InvestmentPlan }
  | { type: 'PAUSE_PLAN'; payload: { id: string } }
  | { type: 'RESUME_PLAN'; payload: { id: string } }
  | { type: 'END_PLAN'; payload: { id: string } }
  | { type: 'GENERATE_DCA_TX'; payload: { planId: string; date: string; fxRate: number } }
  | { type: 'SET_LAST_UPDATED'; payload: string }
  | { type: 'ADD_INSTRUMENT'; payload: Instrument }
  | { type: 'UPSERT_INSTRUMENT'; payload: Instrument }
  | {
      type: 'INIT_PERSONAL_DATA';
      payload: { instruments: Instrument[]; transactions: Transaction[]; plans: InvestmentPlan[] };
    }
  | { type: 'REPLACE_LEDGER'; payload: LedgerPayload }
  | { type: 'IMPORT_LEDGER'; payload: LedgerPayload }
  | { type: 'CLEAR_CLOUD_LEDGER' }
  | { type: 'CLEAR_PERSONAL_DATA' }
  | { type: 'HYDRATE_MARKET_DATA'; payload: { bundle: MarketDataBundle; settings: AppSettings } }
  | { type: 'RESET_STATE' };

function detachCashReceipt(
  dividends: DividendEvent[],
  linkedDividendId: unknown,
): DividendEvent[] {
  if (typeof linkedDividendId !== 'string') return dividends;
  return dividends.flatMap((dividend) => {
    if (dividend.id !== linkedDividendId) return [dividend];
    if (dividend.manual) return [];
    const restored = { ...dividend };
    delete restored.actualReceived;
    delete restored.deviationPct;
    restored.netAmount = Math.max(
      0,
      restored.grossAmount - restored.taxWithheld - restored.contingentTax,
    );
    if (restored.status === 'RECONCILED') restored.status = 'PAID';
    return [restored];
  });
}

export function reducer(state: DataState, action: DataAction): DataState {
  switch (action.type) {
    case 'ADD_TRANSACTION':
      return { ...state, transactions: [...state.transactions, action.payload] };

    case 'UPDATE_TRANSACTION': {
      const previous = state.transactions.find((item) => item.id === action.payload.id);
      const next = previous ? { ...previous, ...action.payload.patch } : null;
      const previousDividendId = previous?.meta?.dividendEventId;
      const nextDividendId = next?.meta?.dividendEventId;
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          t.id === action.payload.id ? { ...t, ...action.payload.patch } : t,
        ),
        dividends:
          previousDividendId !== nextDividendId
            ? detachCashReceipt(state.dividends, previousDividendId)
            : state.dividends,
      };
    }

    case 'DELETE_TRANSACTION': {
      const transaction = state.transactions.find((item) => item.id === action.payload.id);
      const linkedDividendId = transaction?.meta?.dividendEventId;
      return {
        ...state,
        transactions: state.transactions.filter((t) => t.id !== action.payload.id),
        dividends: detachCashReceipt(state.dividends, linkedDividendId),
      };
    }

    case 'CONFIRM_PENDING': {
      return {
        ...state,
        transactions: state.transactions.map((t) => {
          if (t.id !== action.payload.id) return t;
          if (action.payload.actualQuantity !== undefined) {
            const qty = action.payload.actualQuantity;
            if (!Number.isFinite(qty) || qty <= 0) return t;
            const base: Transaction = { ...t, status: 'CONFIRMED' };
            const price = qty > 0 ? t.amount / qty : t.price;
            return { ...base, quantity: qty, price, meta: { ...t.meta, actualQuantity: qty } };
          }
          // 没有真实成交份额时保持待确认，防止 0 份交易污染持仓和收益。
          return t;
        }),
      };
    }

    case 'VOID_PENDING': {
      const ids = new Set(action.payload.ids);
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          ids.has(t.id) ? { ...t, status: 'VOIDED' } : t,
        ),
      };
    }

    case 'UPSERT_DIVIDEND': {
      const exists = state.dividends.some((d) => d.id === action.payload.id);
      return {
        ...state,
        dividends: exists
          ? state.dividends.map((d) => (d.id === action.payload.id ? action.payload : d))
          : [...state.dividends, action.payload],
      };
    }

    case 'BACKFILL_DIVIDEND':
      return {
        ...state,
        dividends: state.dividends.map((d) =>
          d.id === action.payload.id
            ? { ...d, actualReceived: action.payload.actualReceived, status: 'RECONCILED' }
            : d,
        ),
      };

    case 'OVERRIDE_TAX_WITHHELD':
      return {
        ...state,
        dividends: state.dividends.map((d) =>
          d.id === action.payload.id
            ? { ...d, taxWithheldOverride: action.payload.amount }
            : d,
        ),
      };

    case 'ADD_NOTIFICATION': {
      const dup = state.notifications.some((n) => n.key === action.payload.key);
      if (dup) return state;
      return { ...state, notifications: [action.payload, ...state.notifications] };
    }

    case 'MARK_NOTIFICATION_READ':
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === action.payload.id ? { ...n, read: true } : n,
        ),
      };

    case 'MARK_ALL_NOTIFICATIONS_READ':
      return {
        ...state,
        notifications: state.notifications.map((n) => ({ ...n, read: true })),
      };

    case 'UPSERT_PLAN': {
      const exists = state.plans.some((p) => p.id === action.payload.id);
      return {
        ...state,
        plans: exists
          ? state.plans.map((p) => (p.id === action.payload.id ? action.payload : p))
          : [...state.plans, action.payload],
      };
    }

    case 'PAUSE_PLAN':
      return {
        ...state,
        plans: state.plans.map((p) =>
          p.id === action.payload.id ? { ...p, status: 'PAUSED' } : p,
        ),
      };

    case 'RESUME_PLAN':
      return {
        ...state,
        plans: state.plans.map((p) =>
          p.id === action.payload.id ? { ...p, status: 'ACTIVE' } : p,
        ),
      };

    case 'END_PLAN':
      return {
        ...state,
        plans: state.plans.map((p) =>
          p.id === action.payload.id ? { ...p, status: 'ENDED' } : p,
        ),
      };

    case 'GENERATE_DCA_TX': {
      const plan = state.plans.find((p) => p.id === action.payload.planId);
      const instrument = state.instruments.find((i) => i.id === plan?.instrumentId);
      if (!plan || !instrument) return state;
      const tx: Transaction = {
        id: uid('tx-dca'),
        instrumentId: instrument.id,
        type: 'BUY',
        status: 'PENDING',
        date: action.payload.date,
        quantity: 0,
        price: 0,
        amount: plan.amount,
        currency: instrument.currency,
        fxRate:
          Number.isFinite(action.payload.fxRate) && action.payload.fxRate > 0
            ? action.payload.fxRate
            : 1,
        note: '定投自动排期生成，净值回填份额后确认',
        source: 'DCA',
        meta: { planId: plan.id },
      };
      return { ...state, transactions: [...state.transactions, tx] };
    }

    case 'SET_LAST_UPDATED':
      return { ...state, lastUpdated: action.payload };

    case 'ADD_INSTRUMENT': {
      // 同 id 已存在 → 原样返回，避免持仓表出现两行同标的（新增语义 ≠ 覆盖）
      if (state.instruments.some((i) => i.id === action.payload.id)) return state;
      return { ...state, instruments: [...state.instruments, action.payload] };
    }

    case 'UPSERT_INSTRUMENT': {
      const exists = state.instruments.some((i) => i.id === action.payload.id);
      return {
        ...state,
        instruments: exists
          ? state.instruments.map((i) => (i.id === action.payload.id ? action.payload : i))
          : [...state.instruments, action.payload],
      };
    }

    case 'INIT_PERSONAL_DATA':
      // 只覆盖个人数据三切片；notifications / dividends / prices / fx 不受影响
      return {
        ...state,
        instruments: action.payload.instruments,
        transactions: action.payload.transactions,
        plans: action.payload.plans,
      };

    case 'REPLACE_LEDGER':
    case 'IMPORT_LEDGER': {
      // Durable notifications are part of the cloud ledger, so the merged cloud
      // snapshot is authoritative for edits and deletions. Generated notifications
      // are device-local market projections and must survive a ledger replacement.
      const durableReadKeys = new Set(
        state.notifications
          .filter((notification) => !notification.id.startsWith('gen-') && notification.read)
          .map((notification) => notification.key),
      );
      const generatedNotifications = state.notifications.filter((notification) =>
        notification.id.startsWith('gen-'),
      );
      const durableNotifications = action.payload.notifications
        .filter((notification) => !notification.id.startsWith('gen-'))
        .map((notification) =>
          durableReadKeys.has(notification.key) ? { ...notification, read: true } : notification,
        );
      return {
        ...state,
        instruments: action.payload.instruments,
        transactions: action.payload.transactions,
        plans: action.payload.plans,
        dividends: mergeDividends(action.payload.dividends, stripUserEdits(state.dividends)),
        notifications: [...generatedNotifications, ...durableNotifications],
      };
    }

    case 'CLEAR_PERSONAL_DATA':
      // 只清个人数据三切片：市场数据（prices/fx/dividends/sourceHealth）保留，
      // 避免清空后白屏还要重新等一遍 1MB 行情。
      return { ...state, instruments: [], transactions: [], plans: [] };

    case 'CLEAR_CLOUD_LEDGER':
      return {
        ...state,
        instruments: [],
        transactions: [],
        plans: [],
        dividends: stripUserEdits(state.dividends),
        notifications: [],
      };

    case 'HYDRATE_MARKET_DATA':
      return applyMarketData(state, action.payload.bundle, action.payload.settings);

    case 'RESET_STATE': {
      // 个人数据回到空白账本，已加载的真实行情保留（避免重置后白屏），
      // 分红只清除用户手工订正、保留管道事实。随后 DataProvider 会再跑一次 hydrate。
      return {
        ...emptyDataState(),
        prices: state.prices,
        fx: state.fx,
        dividends: stripUserEdits(state.dividends),
        sourceHealth: state.sourceHealth,
        lastUpdated: state.lastUpdated,
      };
    }

    default:
      return state;
  }
}

// ============ 持久化编解码 ============

function toPersisted(state: DataState): PersistedDataState {
  const { prices: _prices, fx: _fx, ...rest } = state;
  return rest;
}

function emptyDataState(): DataState {
  return {
    instruments: [],
    transactions: [],
    dividends: [],
    plans: [],
    notifications: [],
    prices: [],
    fx: [],
    lastUpdated: '',
    sourceHealth: {},
  };
}

function isArrayOf<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

/** 反序列化：缺字段/脏数据一律回落到空白账本，保证 state 形状始终合法 */
function fromPersisted(raw: PersistedDataState | null): DataState {
  const base = emptyDataState();
  if (!raw || typeof raw !== 'object') return base;

  return {
    ...base,
    instruments: isArrayOf<DataState['instruments'][number]>(raw.instruments)
      ? raw.instruments
      : [],
    transactions: isArrayOf<Transaction>(raw.transactions) ? raw.transactions : base.transactions,
    plans: isArrayOf<InvestmentPlan>(raw.plans) ? raw.plans : base.plans,
    notifications: isArrayOf<Notification>(raw.notifications) ? raw.notifications : [],
    dividends: isArrayOf<DividendEvent>(raw.dividends) ? raw.dividends : [],
    sourceHealth:
      raw.sourceHealth && typeof raw.sourceHealth === 'object' ? raw.sourceHealth : {},
    lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : '',
    prices: [],
    fx: [],
  };
}

/** 清理旧版本缓存，避免 v1 种子行情占着配额还可能被误读 */
function purgeLegacyStorage(): void {
  if (typeof window === 'undefined') return;
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 隐私模式下不可写 → 忽略
    }
  }
}

/** 浏览器下载：Blob + a[download]，用完立刻回收 objectURL */
function triggerDownload(fileName: string, content: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type HydrationStatus = 'LOADING' | 'READY' | 'FAILED';

export interface HydrationState {
  status: HydrationStatus;
  /** 降级告警：缺文件、切片为空、管道自带 warnings */
  warnings: string[];
  error: string | null;
}

export interface DataContextValue {
  state: DataState;
  dispatch: React.Dispatch<DataAction>;
  /** 真实数据加载状态，供数据新鲜度/告警 UI 使用 */
  hydration: HydrationState;
  cloudSync: 'LOCAL' | 'LOADING' | 'SYNCED' | 'ERROR';
  cloudSyncError: string | null;
  /** 仅首次恢复/切换云账号时为 true；日常后台保存不会触发隐私遮罩。 */
  cloudHydrating: boolean;
  /** 手动重新拉取 public/data 管道数据（强制 no-cache，绕过 1 小时浏览器缓存） */
  reloadMarketData: () => void;
  /** 兼容旧备份格式的显式导入入口；启动时不会自动读取公开 holdings.json。 */
  reloadPersonalData: () => Promise<PersonalDataBundle>;
  /** 导出当前个人数据为私有 JSON 备份。 */
  exportPersonalData: () => void;
  /**
   * 从 holdings.json 文本导入个人数据；解析/校验失败抛错，由调用方提示。
   * 文件未包含的切片保留当前数据（不回退种子），返回相应提示文案。
   */
  importPersonalData: (jsonText: string) => string[];
  /**
   * 清空个人数据三切片（标的 / 流水 / 定投计划），市场数据与分红事实保留。
   * 用于「我要从零开始记自己的账」。
   */
  clearPersonalData: () => void;
  addInstrument: (instrument: Instrument) => void;
  upsertInstrument: (instrument: Instrument) => void;
  addTransaction: (tx: Transaction) => void;
  updateTransaction: (id: string, patch: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  confirmPending: (id: string, actualQuantity?: number) => void;
  voidPending: (ids: string[]) => void;
  upsertDividend: (d: DividendEvent) => void;
  backfillDividend: (id: string, actualReceived: number) => void;
  overrideTaxWithheld: (id: string, amount: number) => void;
  addNotification: (n: Notification) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  upsertPlan: (p: InvestmentPlan) => void;
  pausePlan: (id: string) => void;
  resumePlan: (id: string) => void;
  endPlan: (id: string) => void;
  generateDcaTx: (planId: string, date: string) => void;
  setLastUpdated: (ts: string) => void;
  resetState: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { settings, update: updateSettings, reset: resetSettings } = useSettings();
  const { status: authStatus, user: cloudUser, store: cloudStore } = useAuth();
  const [persisted, setPersisted] = useLocalStorage<PersistedDataState | null>(STORAGE_KEY, null);
  const [state, baseDispatch] = useReducer(reducer, persisted, fromPersisted);
  const [hydration, setHydration] = useState<HydrationState>({
    status: 'LOADING',
    warnings: [],
    error: null,
  });
  const [cloudSync, setCloudSync] = useState<'LOCAL' | 'LOADING' | 'SYNCED' | 'ERROR'>('LOCAL');
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const [cloudHydrating, setCloudHydrating] = useState(authStatus === 'CHECKING');
  const cloudReadyRef = useRef(false);
  const lastCloudFingerprintRef = useRef('');
  const pendingCloudFingerprintRef = useRef('');
  const cloudSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const cloudGenerationRef = useRef(0);
  const cloudRevisionRef = useRef<number | null>(null);
  const cleanCloudPayloadRef = useRef<LedgerPayload | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const stateRef = useRef<DataState>(state);
  stateRef.current = state;
  const activeCloudUidRef = useRef<string | null>(null);

  // settings 用 ref 读取：hydrate 不应因为主题/税务设置变动而重跑
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const journal = useMemo(
    () => (typeof window === 'undefined' ? null : new CloudSyncJournal(window.localStorage)),
    [],
  );

  // 写穿透：reducer 后自动持久化（行情/汇率不落盘）
  useEffect(() => {
    setPersisted(toPersisted(state));
  }, [state, setPersisted]);

  useEffect(purgeLegacyStorage, []);

  const makeLedgerPayload = useCallback(
    (sourceState: DataState, sourceSettings: AppSettings): LedgerPayload => ({
      schemaVersion: 1,
      instruments: sourceState.instruments,
      transactions: sourceState.transactions,
      plans: sourceState.plans,
      dividends: sourceState.dividends.filter(
        (dividend) =>
          dividend.manual ||
          dividend.actualReceived !== undefined ||
          dividend.taxWithheldOverride !== undefined,
      ),
      notifications: sourceState.notifications.filter(
        (notification) => !notification.id.startsWith('gen-'),
      ),
      settings: sourceSettings,
      updatedAt: new Date().toISOString(),
    }),
    [],
  );

  const persistDirtySnapshot = useCallback(
    (nextState: DataState, nextSettings: AppSettings): void => {
      const ownerUid = activeCloudUidRef.current;
      if (!ownerUid || !journal || !cloudReadyRef.current) return;
      const payload = makeLedgerPayload(nextState, nextSettings);
      try {
        const fingerprint = ledgerFingerprint(payload);
        const existing = journal.readOutbox(ownerUid);
        if (
          fingerprint === existing?.fingerprint ||
          (!existing && fingerprint === lastCloudFingerprintRef.current)
        ) {
          return;
        }
        journal.stage(
          ownerUid,
          payload,
          cleanCloudPayloadRef.current,
          cloudRevisionRef.current ?? 0,
        );
        setCloudSync('LOADING');
        setCloudSyncError(null);
      } catch (cause) {
        setCloudSyncError(cloudErrorMessage(cause));
        setCloudSync('ERROR');
      }
    },
    [journal, makeLedgerPayload],
  );

  const dispatch = useCallback<React.Dispatch<DataAction>>(
    (action) => {
      const nextState = reducer(stateRef.current, action);
      stateRef.current = nextState;
      if (
        action.type !== 'HYDRATE_MARKET_DATA' &&
        action.type !== 'REPLACE_LEDGER' &&
        action.type !== 'CLEAR_CLOUD_LEDGER' &&
        action.type !== 'SET_LAST_UPDATED'
      ) {
        persistDirtySnapshot(nextState, settingsRef.current);
      }
      baseDispatch(action);
    },
    [persistDirtySnapshot],
  );

  const ledgerHasUserData = useCallback(
    (payload: LedgerPayload) =>
      payload.instruments.length > 0 ||
      payload.transactions.length > 0 ||
      payload.plans.length > 0 ||
      payload.dividends.length > 0,
    [],
  );

  /**
   * 重新拉取市场数据并合入 state。
   *
   * @param signal 中断信号（卸载时取消）。
   * @param cache fetch 缓存策略；默认遵循托管平台响应头，用户手动刷新时传
   *              'no-cache' 强制回源。
   */
  const hydrate = useCallback(async (signal?: AbortSignal, cache?: RequestCache): Promise<void> => {
    setHydration((prev) => ({ ...prev, status: 'LOADING', error: null }));
    try {
      const bundle = await loadMarketData({ signal, cache });
      if (signal?.aborted) return;
      dispatch({ type: 'HYDRATE_MARKET_DATA', payload: { bundle, settings: settingsRef.current } });
      setHydration({ status: 'READY', warnings: bundle.warnings, error: null });
    } catch (error) {
      if (signal?.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error('[DataProvider] 真实数据加载失败：', error);
      setHydration({ status: 'FAILED', warnings: [], error: message });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void hydrate(controller.signal, 'default');
    return () => controller.abort();
  }, [hydrate]);

  const applyCloudPayload = useCallback(
    (payload: LedgerPayload, synced: boolean): void => {
      const canonical = canonicalizeLedgerPayload(payload);
      pendingCloudFingerprintRef.current = ledgerFingerprint(canonical);
      const action: DataAction = { type: 'REPLACE_LEDGER', payload: canonical };
      stateRef.current = reducer(stateRef.current, action);
      baseDispatch(action);
      updateSettings(canonical.settings);
      if (synced) lastCloudFingerprintRef.current = ledgerFingerprint(canonical);
    },
    [updateSettings],
  );

  const flushCloudOutbox = useCallback(
    async (
      ownerUid: string,
      generation: number,
      retryOnConflict = true,
    ): Promise<void> => {
      if (!journal || !cloudStore) return;
      const isCurrent = () =>
        cloudGenerationRef.current === generation && activeCloudUidRef.current === ownerUid;
      const sentOutbox = journal.readOutbox(ownerUid);
      if (!sentOutbox || !isCurrent()) return;

      let outgoing = sentOutbox.payload;
      let expectedRevision = cloudRevisionRef.current;
      try {
        const currentRemote = await cloudStore.load(ownerUid);
        if (!isCurrent()) return;
        expectedRevision = currentRemote?.revision ?? null;
        if (currentRemote) {
          const base = sentOutbox.basePayload ?? cleanCloudPayloadRef.current;
          if (base && ledgerFingerprint(currentRemote.payload) !== ledgerFingerprint(base)) {
            outgoing = mergeLedgerPayloadsThreeWay(
              base,
              sentOutbox.payload,
              currentRemote.payload,
              {
                localRevision: sentOutbox.baseRevision + 1,
                remoteRevision: currentRemote.revision,
                prefer: 'local',
              },
            ).payload;
            journal.rebase(ownerUid, outgoing, currentRemote.payload, currentRemote.revision);
          }
        }

        const saved = await cloudStore.save(outgoing, ownerUid, expectedRevision);
        if (!isCurrent()) return;
        cloudRevisionRef.current = saved.revision;
        cleanCloudPayloadRef.current = saved.payload;
        lastCloudFingerprintRef.current = ledgerFingerprint(saved.payload);
        const acknowledged = journal.acknowledge(
          ownerUid,
          sentOutbox,
          saved.payload,
          saved.revision,
        );
        if (acknowledged.clean) {
          setCloudSyncError(null);
          setCloudSync('SYNCED');
        } else {
          applyCloudPayload(acknowledged.payload, false);
          setCloudSync('LOADING');
          window.setTimeout(() => {
            if (isCurrent()) void flushCloudOutbox(ownerUid, generation);
          }, 0);
        }
      } catch (cause) {
        if (!isCurrent()) return;
        if (retryOnConflict && isCloudSyncConflict(cause)) {
          const latest = await cloudStore.load(ownerUid);
          if (!latest || !isCurrent()) throw cause;
          const base = sentOutbox.basePayload ?? cleanCloudPayloadRef.current;
          if (!base) throw new Error('缺少同步基线，已保留本机修改并暂停覆盖云端');
          const merged = mergeLedgerPayloadsThreeWay(
            base,
            sentOutbox.payload,
            latest.payload,
            {
              localRevision: sentOutbox.baseRevision + 1,
              remoteRevision: latest.revision,
              prefer: 'local',
            },
          ).payload;
          journal.rebase(ownerUid, merged, latest.payload, latest.revision);
          cleanCloudPayloadRef.current = latest.payload;
          cloudRevisionRef.current = latest.revision;
          applyCloudPayload(merged, false);
          return flushCloudOutbox(ownerUid, generation, false);
        }
        setCloudSyncError(cloudErrorMessage(cause));
        setCloudSync('ERROR');
        if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          if (isCurrent()) void flushCloudOutbox(ownerUid, generation);
        }, 5_000);
      }
    },
    [applyCloudPayload, cloudStore, journal],
  );

  // 登录后只读取当前 UID 的 cache/outbox；身份未确认或出错时隔离旧云账本。
  useEffect(() => {
    const generation = ++cloudGenerationRef.current;
    const previousOwnerUid = activeCloudUidRef.current;
    activeCloudUidRef.current = null;
    cloudReadyRef.current = false;
    pendingCloudFingerprintRef.current = '';
    cloudRevisionRef.current = null;
    cleanCloudPayloadRef.current = null;
    cloudSaveQueueRef.current = Promise.resolve();
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (authStatus === 'CHECKING') {
      setCloudHydrating(true);
      return;
    }

    if (authStatus !== 'SIGNED_IN' || !cloudUser || !cloudStore || !journal) {
      // ERROR is an unknown identity, so old cloud data must not remain visible.
      const storedCloudOwner = window.localStorage.getItem(LAST_CLOUD_USER_KEY);
      if (previousOwnerUid || storedCloudOwner || authStatus === 'ERROR') {
        const clearAction: DataAction = { type: 'CLEAR_CLOUD_LEDGER' };
        stateRef.current = reducer(stateRef.current, clearAction);
        baseDispatch(clearAction);
        resetSettings();
      }
      if (authStatus === 'SIGNED_OUT' && storedCloudOwner) {
        // The owner-bound cache/outbox remains available for the next login. Removing only
        // this display marker lets a genuinely anonymous ledger survive future refreshes.
        window.localStorage.removeItem(LAST_CLOUD_USER_KEY);
      }
      setCloudHydrating(authStatus === 'ERROR');
      setCloudSync(authStatus === 'ERROR' ? 'ERROR' : 'LOCAL');
      setCloudSyncError(authStatus === 'ERROR' ? '无法确认云端账号，请刷新后重试' : null);
      return;
    }

    const ownerUid = cloudUser.uid;
    activeCloudUidRef.current = ownerUid;
    setCloudHydrating(true);
    setCloudSync('LOADING');
    setCloudSyncError(null);
    const isCurrent = () =>
      cloudGenerationRef.current === generation && activeCloudUidRef.current === ownerUid;

    void (async () => {
      const cached = journal.readCache(ownerUid);
      const outbox = journal.readOutbox(ownerUid);
      const genericLocal = makeLedgerPayload(stateRef.current, settingsRef.current);
      const previousCloudUser = window.localStorage.getItem(LAST_CLOUD_USER_KEY);
      const canMigrateAnonymous = !previousCloudUser && ledgerHasUserData(genericLocal);
      const localPayload = outbox?.payload ?? cached?.payload ??
        makeLedgerPayload(emptyDataState(), settingsRef.current);
      const remoteSnapshot = await cloudStore.load(ownerUid);
      if (!isCurrent()) return;
      const remotePayload = remoteSnapshot?.payload ?? null;
      cloudRevisionRef.current = remoteSnapshot?.revision ?? null;

      const decision = decideHydration({
        ownerUid,
        local: localPayload,
        remote: remotePayload,
        outbox,
        remoteRevision: remoteSnapshot?.revision,
        knownBaseFingerprint: cached?.fingerprint ?? null,
      });
      if (decision.mode === 'BLOCK') {
        throw new Error('本机待同步记录属于另一个账号，已停止同步');
      }

      let target = decision.payload;
      let migratedAnonymous = false;
      if (canMigrateAnonymous) {
        const merged = mergeAnonymousLedgerForLogin(target, genericLocal);
        migratedAnonymous = ledgerFingerprint(merged) !== ledgerFingerprint(target);
        target = merged;
      }
      const shouldUpload =
        (decision.mode === 'KEEP_LOCAL' && decision.shouldUpload) ||
        decision.mode === 'MERGE' ||
        migratedAnonymous ||
        (!remotePayload && ledgerHasUserData(target));
      if (remotePayload) cleanCloudPayloadRef.current = remotePayload;
      if (shouldUpload) {
        journal.rebase(
          ownerUid,
          target,
          remotePayload ?? makeLedgerPayload(emptyDataState(), target.settings),
          remoteSnapshot?.revision ?? 0,
        );
      } else {
        journal.acceptRemote(ownerUid, target);
        cleanCloudPayloadRef.current = target;
        lastCloudFingerprintRef.current = ledgerFingerprint(target);
      }
      applyCloudPayload(target, !shouldUpload);
      window.localStorage.setItem(LAST_CLOUD_USER_KEY, ownerUid);
      if (!isCurrent()) return;
      cloudReadyRef.current = true;
      setCloudHydrating(false);
      setCloudSync(shouldUpload ? 'LOADING' : 'SYNCED');
      if (shouldUpload) void flushCloudOutbox(ownerUid, generation);
    })().catch((cause) => {
      if (!isCurrent()) return;
      setCloudHydrating(true);
      setCloudSyncError(cloudErrorMessage(cause));
      setCloudSync('ERROR');
    });

    return () => {
      if (cloudGenerationRef.current === generation) cloudGenerationRef.current += 1;
    };
  }, [
    applyCloudPayload,
    authStatus,
    cloudStore,
    cloudUser?.uid,
    flushCloudOutbox,
    journal,
    ledgerHasUserData,
    makeLedgerPayload,
    resetSettings,
  ]);

  // A payload application is a bounded React update, not a content-equality gate.
  useEffect(() => {
    if (!pendingCloudFingerprintRef.current || !cloudReadyRef.current) return;
    pendingCloudFingerprintRef.current = '';
  }, [state, settings]);

  // Settings changes are outside DataContext actions, so stage them immediately after render.
  useEffect(() => {
    if (!cloudReadyRef.current || !activeCloudUidRef.current || !journal) return;
    const payload = makeLedgerPayload(stateRef.current, settings);
    if (ledgerFingerprint(payload) === lastCloudFingerprintRef.current) return;
    try {
      journal.stage(
        activeCloudUidRef.current,
        payload,
        cleanCloudPayloadRef.current,
        cloudRevisionRef.current ?? 0,
      );
      setCloudSync('LOADING');
    } catch (cause) {
      setCloudSyncError(cloudErrorMessage(cause));
      setCloudSync('ERROR');
    }
  }, [journal, makeLedgerPayload, settings]);

  // Network writes are debounced, but the journal above already contains every accepted edit.
  useEffect(() => {
    const ownerUid = activeCloudUidRef.current;
    if (!cloudReadyRef.current || !ownerUid || authStatus !== 'SIGNED_IN' || !journal) return;
    let outbox: SyncOutboxEntry | null;
    try {
      outbox = journal.readOutbox(ownerUid);
    } catch (cause) {
      setCloudSyncError(cloudErrorMessage(cause));
      setCloudSync('ERROR');
      return;
    }
    if (!outbox) return;
    const generation = cloudGenerationRef.current;
    const timer = window.setTimeout(() => {
      cloudSaveQueueRef.current = cloudSaveQueueRef.current
        .catch(() => undefined)
        .then(() => flushCloudOutbox(ownerUid, generation));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [state, settings, authStatus, flushCloudOutbox, journal]);

  const reloadMarketData = useCallback(() => {
    // ★手动刷新必须绕过 1 小时缓存，否则用户点了「刷新」却拿到同一份旧数据
    void hydrate(undefined, 'no-cache');
  }, [hydrate]);

  const reloadPersonalData = useCallback(async (): Promise<PersonalDataBundle> => {
    // 仅保留给旧版备份迁移；新版本不会自动读取公开个人数据文件。
    const bundle: PersonalDataBundle = await loadPersonalData({ cache: 'no-cache' });
    // ★只有真的读到 holdings.json 才落地：seed-fallback 时若照样 dispatch，
    //   写穿透会把用户 localStorage 里的编辑替换成演示种子且不可撤销 ——
    //   「文件读不到」绝不能变成「清空用户数据」。此时只把 bundle 交回调用方报错。
    if (bundle.source !== 'file') return bundle;

    dispatch({
      type: 'INIT_PERSONAL_DATA',
      payload: {
        instruments: bundle.instruments,
        transactions: bundle.transactions,
        plans: bundle.plans,
      },
    });
    // ★把降级信号原样交回调用方：吞掉 source 会让「读取失败回退种子」看起来像成功
    return bundle;
  }, []);

  const privacyHydrating =
    cloudHydrating ||
    (authStatus !== 'SIGNED_IN' && activeCloudUidRef.current !== null);

  const value = useMemo<DataContextValue>(() => {
    return {
      state,
      dispatch,
      hydration,
      cloudSync,
      cloudSyncError,
      cloudHydrating: privacyHydrating,
      reloadMarketData,
      reloadPersonalData,
      exportPersonalData: () => {
        triggerDownload(
          'dividend-tracker-backup.json',
          downloadLedgerBackup(makeLedgerPayload(state, settings)),
        );
      },
      importPersonalData: (jsonText: string): string[] => {
        const raw: unknown = JSON.parse(jsonText);
        const complete = parseLedgerBackup(raw);
        if (complete) {
          updateSettings(complete.settings);
          dispatch({ type: 'IMPORT_LEDGER', payload: complete });
          return [];
        }
        if (!hasPersonalSlices(raw)) {
          throw new Error('文件内容为空：至少需要 instruments / transactions / plans 中的一个非空数组');
        }
        // ★以「当前数据」而非「演示种子」兜底：导入只含 instruments 的文件时，
        //   流水与定投计划必须原样保留，否则一次导入就把用户账本换成了 demo。
        const { slices, warnings } = mergeImportedSlices(
          {
            instruments: state.instruments,
            transactions: state.transactions,
            plans: state.plans,
          },
          raw,
        );
        dispatch({ type: 'INIT_PERSONAL_DATA', payload: slices });
        return warnings;
      },
      clearPersonalData: () => {
        dispatch({ type: 'CLEAR_PERSONAL_DATA' });
        // 行情/汇率不落盘，清空后重拉一次保证图表与市值仍有数据可算
        void hydrate();
      },
      addInstrument: (instrument) => dispatch({ type: 'ADD_INSTRUMENT', payload: instrument }),
      upsertInstrument: (instrument) => dispatch({ type: 'UPSERT_INSTRUMENT', payload: instrument }),
      addTransaction: (tx) => dispatch({ type: 'ADD_TRANSACTION', payload: tx }),
      updateTransaction: (id, patch) => dispatch({ type: 'UPDATE_TRANSACTION', payload: { id, patch } }),
      deleteTransaction: (id) => dispatch({ type: 'DELETE_TRANSACTION', payload: { id } }),
      confirmPending: (id, actualQuantity) =>
        dispatch({ type: 'CONFIRM_PENDING', payload: { id, actualQuantity } }),
      voidPending: (ids) => dispatch({ type: 'VOID_PENDING', payload: { ids } }),
      upsertDividend: (d) => dispatch({ type: 'UPSERT_DIVIDEND', payload: d }),
      backfillDividend: (id, actualReceived) =>
        dispatch({ type: 'BACKFILL_DIVIDEND', payload: { id, actualReceived } }),
      overrideTaxWithheld: (id, amount) =>
        dispatch({ type: 'OVERRIDE_TAX_WITHHELD', payload: { id, amount } }),
      addNotification: (n) => dispatch({ type: 'ADD_NOTIFICATION', payload: n }),
      markNotificationRead: (id) => dispatch({ type: 'MARK_NOTIFICATION_READ', payload: { id } }),
      markAllNotificationsRead: () => dispatch({ type: 'MARK_ALL_NOTIFICATIONS_READ' }),
      upsertPlan: (p) => dispatch({ type: 'UPSERT_PLAN', payload: p }),
      pausePlan: (id) => dispatch({ type: 'PAUSE_PLAN', payload: { id } }),
      resumePlan: (id) => dispatch({ type: 'RESUME_PLAN', payload: { id } }),
      endPlan: (id) => dispatch({ type: 'END_PLAN', payload: { id } }),
      generateDcaTx: (planId, date) => {
        const plan = state.instruments.length > 0
          ? state.plans.find((item) => item.id === planId)
          : undefined;
        const instrument = plan
          ? state.instruments.find((item) => item.id === plan.instrumentId)
          : undefined;
        const fxRate = instrument
          ? fxOn(state.fx, instrument.currency, settings.baseCurrency, date)
          : 1;
        dispatch({ type: 'GENERATE_DCA_TX', payload: { planId, date, fxRate } });
      },
      setLastUpdated: (ts) => dispatch({ type: 'SET_LAST_UPDATED', payload: ts }),
      resetState: () => {
        dispatch({ type: 'RESET_STATE' });
        void hydrate();
      },
    };
  }, [
    state,
    hydration,
    cloudSync,
    cloudSyncError,
    privacyHydrating,
    reloadMarketData,
    reloadPersonalData,
    hydrate,
    dispatch,
    settings,
    makeLedgerPayload,
    updateSettings,
  ]);

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}

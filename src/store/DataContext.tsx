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
import { buildPersonalState } from '@/data';
import {
  downloadHoldings,
  hasPersonalSlices,
  loadPersonalData,
  mergeImportedSlices,
  mergePersonalData,
  PersonalDataBundle,
} from '@/data/personalData';
import { applyMarketData, loadMarketData, MarketDataBundle, stripUserEdits } from '@/data/realData';
import { uid } from '@/lib/clock';
import { useSettings } from './SettingsContext';
import { useLocalStorage } from './useLocalStorage';

/**
 * DataStore（architecture.md §5.2）
 * useReducer + 自动持久化；所有业务变更经 actions，乐观更新 + 级联重算。
 *
 * 数据分层：
 * - 个人数据基线（instruments/transactions/plans）→ public/data/holdings.json，用户手工维护、
 *   提交后多设备同步；localStorage 里的运行期编辑作为 overlay 叠加其上（mergePersonalData）。
 * - 个人数据运行期（notifications/分红手工订正 + 上述 overlay）→ 持久化到 localStorage
 * - 市场数据（prices/fx/dividends/sourceHealth）→ 每次启动从 public/data 真实管道重新加载，
 *   既避免旧缓存覆盖真实行情，也避免 5MB 配额被上万条行情撑爆。
 */

/** ★v2：真实数据接入，schema 与持久化范围均变更，旧版 v1 种子缓存直接作废 */
const STORAGE_KEY = 'dt:state:v2';
const LEGACY_STORAGE_KEYS = ['dt:state:v1'];
/** 上一次「已接受」的服务器基线元信息，用于提示服务器有更新版 holdings.json */
const BASELINE_META_KEY = 'dt:baseline:v1';

/** 服务器基线元信息（目前只记 generatedAt） */
export interface BaselineMeta {
  generatedAt?: string;
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
  | { type: 'GENERATE_DCA_TX'; payload: { planId: string; date: string } }
  | { type: 'SET_LAST_UPDATED'; payload: string }
  | {
      type: 'INIT_PERSONAL_DATA';
      payload: { instruments: Instrument[]; transactions: Transaction[]; plans: InvestmentPlan[] };
    }
  | { type: 'HYDRATE_MARKET_DATA'; payload: { bundle: MarketDataBundle; settings: AppSettings } }
  | { type: 'RESET_STATE' };

function reducer(state: DataState, action: DataAction): DataState {
  switch (action.type) {
    case 'ADD_TRANSACTION':
      return { ...state, transactions: [...state.transactions, action.payload] };

    case 'UPDATE_TRANSACTION':
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          t.id === action.payload.id ? { ...t, ...action.payload.patch } : t,
        ),
      };

    case 'DELETE_TRANSACTION':
      return {
        ...state,
        transactions: state.transactions.filter((t) => t.id !== action.payload.id),
      };

    case 'CONFIRM_PENDING': {
      return {
        ...state,
        transactions: state.transactions.map((t) => {
          if (t.id !== action.payload.id) return t;
          const base: Transaction = { ...t, status: 'CONFIRMED' };
          if (action.payload.actualQuantity !== undefined) {
            const qty = action.payload.actualQuantity;
            const price = qty > 0 ? t.amount / qty : t.price;
            return { ...base, quantity: qty, price, meta: { ...t.meta, actualQuantity: qty } };
          }
          return base;
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
        fxRate: 1,
        note: '定投自动排期生成，净值回填份额后确认',
        source: 'DCA',
        meta: { planId: plan.id },
      };
      return { ...state, transactions: [...state.transactions, tx] };
    }

    case 'SET_LAST_UPDATED':
      return { ...state, lastUpdated: action.payload };

    case 'INIT_PERSONAL_DATA':
      // 只覆盖个人数据三切片；notifications / dividends / prices / fx 不受影响
      return {
        ...state,
        instruments: action.payload.instruments,
        transactions: action.payload.transactions,
        plans: action.payload.plans,
      };

    case 'HYDRATE_MARKET_DATA':
      return applyMarketData(state, action.payload.bundle, action.payload.settings);

    case 'RESET_STATE': {
      // 个人数据回到初始种子，已加载的真实行情保留（避免重置后白屏），
      // 分红只清除用户手工订正、保留管道事实。随后 DataProvider 会再跑一次 hydrate。
      return {
        ...buildPersonalState(),
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

function isArrayOf<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

/** 反序列化：缺字段/脏数据一律回落到个人数据基线，保证 state 形状始终合法 */
function fromPersisted(raw: PersistedDataState | null): DataState {
  const base = buildPersonalState();
  if (!raw || typeof raw !== 'object') return base;

  return {
    ...base,
    instruments: isArrayOf<DataState['instruments'][number]>(raw.instruments) && raw.instruments.length > 0
      ? raw.instruments
      : base.instruments,
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

/**
 * 判断本机是否已有「运行期编辑」——即挂载瞬间的 localStorage 快照里存在非空个人数据切片。
 * 首次访问（快照为 null / 三片皆空）不算 overlay：此时服务器基线本就会被完整采用，
 * 再提示「服务器有更新」纯属噪音。
 */
function hasLocalOverlay(snapshot: PersistedDataState | null): boolean {
  if (!snapshot) return false;
  return (['instruments', 'transactions', 'plans'] as const).some((key) => {
    const slice = snapshot[key] as unknown;
    return Array.isArray(slice) && slice.length > 0;
  });
}

/** ISO 时间戳 → 展示用日期（YYYY-MM-DD）；非法值原样返回 */
function isoDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
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
  /** 手动重新拉取 public/data 管道数据 */
  reloadMarketData: () => void;
  /**
   * 重新拉取 public/data/holdings.json，用服务器基线覆盖个人数据三切片。
   * 返回加载结果 bundle，调用方据此区分「真的从文件加载」还是「降级到内置种子」。
   */
  reloadPersonalData: () => Promise<PersonalDataBundle>;
  /** 导出当前个人数据为 holdings.json 文件（提交回仓库即可多设备同步） */
  exportPersonalData: () => void;
  /**
   * 从 holdings.json 文本导入个人数据；解析/校验失败抛错，由调用方提示。
   * 文件未包含的切片保留当前数据（不回退种子），返回相应提示文案。
   */
  importPersonalData: (jsonText: string) => string[];
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
  const { settings } = useSettings();
  const [persisted, setPersisted] = useLocalStorage<PersistedDataState | null>(STORAGE_KEY, null);
  const [baselineMeta, setBaselineMeta] = useLocalStorage<BaselineMeta | null>(
    BASELINE_META_KEY,
    null,
  );
  const [state, dispatch] = useReducer(reducer, persisted, fromPersisted);
  const [hydration, setHydration] = useState<HydrationState>({
    status: 'LOADING',
    warnings: [],
    error: null,
  });
  const [bypassBootError, setBypassBootError] = useState(false);

  // settings 用 ref 读取：hydrate 不应因为主题/税务设置变动而重跑
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  // ★只取挂载瞬间的 localStorage 快照：写穿透 effect 会在首帧就把 state 回写 persisted，
  //   若每渲染刷新此 ref，boot 的 await 结束后拿到的将是「种子回填后的 state」，
  //   overlay 永远命中 → holdings.json 基线形同虚设。
  const persistedRef = useRef<PersistedDataState | null>(persisted);

  // 同理只取挂载瞬间的基线元信息：boot 内部会写入新值，逐渲染刷新会让「是否有更新」永远为假
  const baselineRef = useRef<BaselineMeta | null>(baselineMeta);

  // 写穿透：reducer 后自动持久化（行情/汇率不落盘）
  useEffect(() => {
    setPersisted(toPersisted(state));
  }, [state, setPersisted]);

  useEffect(purgeLegacyStorage, []);

  const hydrate = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setHydration((prev) => ({ ...prev, status: 'LOADING', error: null }));
    try {
      const bundle = await loadMarketData({ signal });
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

  /**
   * 启动流程：并行拉取「个人数据基线 + 市场数据」。
   * 个人数据先落地再 hydrate 行情，保证 applyMarketData 的通知重算基于最终持仓。
   * 只在挂载时跑一次；reloadMarketData / resetState 走 hydrate（不重置个人数据）。
   */
  const boot = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setHydration((prev) => ({ ...prev, status: 'LOADING', error: null }));
    try {
      const [personal, market] = await Promise.all([
        loadPersonalData({ signal }),
        loadMarketData({ signal }),
      ]);
      if (signal?.aborted) return;

      const merged = mergePersonalData(personal, persistedRef.current);
      dispatch({ type: 'INIT_PERSONAL_DATA', payload: merged });
      dispatch({ type: 'HYDRATE_MARKET_DATA', payload: { bundle: market, settings: settingsRef.current } });

      const warnings = [...personal.warnings, ...market.warnings];
      if (personal.source === 'file') {
        // 回访用户：本地编辑优先（overlay 已胜出），此时若服务器基线更新只「告知」，
        // 绝不自动覆盖用户数据 —— 静默覆盖等于数据丢失。
        const previous = baselineRef.current?.generatedAt;
        const incoming = personal.generatedAt;
        if (hasLocalOverlay(persistedRef.current) && incoming && previous && incoming > previous) {
          warnings.push(
            `服务器有更新的 holdings.json（${isoDate(incoming)}），可在设置页点「从服务器重新加载」同步`,
          );
        }
        setBaselineMeta({ generatedAt: incoming });
      }

      setHydration({ status: 'READY', warnings, error: null });
    } catch (error) {
      if (signal?.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error('[DataProvider] 真实数据加载失败：', error);
      setHydration({ status: 'FAILED', warnings: [], error: message });
    }
  }, [setBaselineMeta]);

  useEffect(() => {
    const controller = new AbortController();
    void boot(controller.signal);
    return () => controller.abort();
  }, [boot]);

  const reloadMarketData = useCallback(() => {
    setBypassBootError(false);
    void hydrate();
  }, [hydrate]);

  const reloadPersonalData = useCallback(async (): Promise<PersonalDataBundle> => {
    const bundle: PersonalDataBundle = await loadPersonalData();
    dispatch({
      type: 'INIT_PERSONAL_DATA',
      payload: {
        instruments: bundle.instruments,
        transactions: bundle.transactions,
        plans: bundle.plans,
      },
    });
    // 主动同步 = 用户已接受这份服务器基线，刷新元信息避免重复提示
    if (bundle.source === 'file') setBaselineMeta({ generatedAt: bundle.generatedAt });
    // ★把降级信号原样交回调用方：吞掉 source 会让「读取失败回退种子」看起来像成功
    return bundle;
  }, [setBaselineMeta]);

  const value = useMemo<DataContextValue>(() => {
    return {
      state,
      dispatch,
      hydration,
      reloadMarketData,
      reloadPersonalData,
      exportPersonalData: () => {
        triggerDownload('holdings.json', downloadHoldings(state));
      },
      importPersonalData: (jsonText: string): string[] => {
        const raw: unknown = JSON.parse(jsonText);
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
      generateDcaTx: (planId, date) => dispatch({ type: 'GENERATE_DCA_TX', payload: { planId, date } }),
      setLastUpdated: (ts) => dispatch({ type: 'SET_LAST_UPDATED', payload: ts }),
      resetState: () => {
        dispatch({ type: 'RESET_STATE' });
        void hydrate();
      },
    };
  }, [state, hydration, reloadMarketData, reloadPersonalData, hydrate]);

  const hasMarketData = state.prices.length > 0;
  const showBoot = !hasMarketData && !bypassBootError && hydration.status !== 'READY';

  return (
    <DataContext.Provider value={value}>
      {showBoot ? (
        <DataBootScreen
          hydration={hydration}
          onRetry={reloadMarketData}
          onDismiss={() => setBypassBootError(true)}
        />
      ) : (
        children
      )}
    </DataContext.Provider>
  );
}

/** 启动屏：真实数据加载中 / 加载失败（可重试或空数据继续） */
function DataBootScreen({
  hydration,
  onRetry,
  onDismiss,
}: {
  hydration: HydrationState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const failed = hydration.status === 'FAILED';
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-3">
        <div className="text-[15px] text-primary font-medium">
          {failed ? '市场数据加载失败' : '正在加载市场数据…'}
        </div>
        <div className="text-[12px] text-secondary leading-relaxed">
          {failed
            ? hydration.error ?? '未知错误'
            : '从 public/data 读取行情、汇率与分红事件'}
        </div>
        {failed && (
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={onRetry}
              className="px-3 py-1.5 text-[12px] rounded-md bg-card-hover text-primary"
            >
              重试
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1.5 text-[12px] rounded-md text-secondary"
            >
              以空数据继续
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}

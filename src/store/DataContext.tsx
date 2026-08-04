import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import { DataState, DividendEvent, InvestmentPlan, Notification, Transaction } from '@/types';
import { buildSeedState } from '@/data';
import { uid } from '@/lib/clock';
import { useLocalStorage } from './useLocalStorage';

/**
 * DataStore（architecture.md §5.2）
 * useReducer + 自动持久化；所有业务变更经 actions，乐观更新 + 级联重算。
 */

const STORAGE_KEY = 'dt:state:v1';

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

    case 'RESET_STATE':
      return buildSeedState();

    default:
      return state;
  }
}

export interface DataContextValue {
  state: DataState;
  dispatch: React.Dispatch<DataAction>;
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
  const [persisted, setPersisted] = useLocalStorage<DataState>(STORAGE_KEY, buildSeedState());
  const [state, dispatch] = useReducer(reducer, persisted);

  // 写穿透：reducer 后自动持久化
  useEffect(() => {
    setPersisted(state);
  }, [state, setPersisted]);

  const value = useMemo<DataContextValue>(() => {
    return {
      state,
      dispatch,
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
      resetState: () => dispatch({ type: 'RESET_STATE' }),
    };
  }, [state]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cloudConfig, cloudEnabled } from '@/config/cloud';
import { getCloudStore, type CloudStore, type CloudUser } from '@/data/cloud';

export type AuthStatus = 'DISABLED' | 'CHECKING' | 'SIGNED_OUT' | 'SIGNED_IN' | 'ERROR';

interface AuthContextValue {
  cloudEnabled: boolean;
  status: AuthStatus;
  user: CloudUser | null;
  error: string | null;
  store: CloudStore | null;
  signIn: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, inviteCode: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Keep a stalled CloudBase request from holding the whole app open forever. */
export const AUTH_OPERATION_TIMEOUT_MS = 12_000;
const AUTH_SESSION_CHECK_INTERVAL_MS = 60_000;

export type CloudAuthSignal =
  | { kind: 'SIGNED_OUT'; reason: 'SIGNED_OUT' | 'EXPIRED' }
  | { kind: 'RECHECK'; reason: 'SIGNED_IN' | 'INITIAL_SESSION' | 'USER_UPDATED' | 'LEGACY_CHANGE' };

interface CloudAuthObserver {
  onAuthStateChange?: (
    callback: (event: string, session?: unknown, info?: unknown) => void,
  ) => {
    data?: { subscription?: { unsubscribe?: () => void } };
  };
  onLoginStateChanged?: (callback: (payload: unknown) => void) => unknown;
  onLoginStateExpired?: (callback: () => void) => unknown;
}

let authObserverPromise: Promise<CloudAuthObserver> | null = null;

async function getCloudAuthObserver(): Promise<CloudAuthObserver> {
  if (!cloudConfig.envId) throw new Error('尚未配置 CloudBase 环境');
  if (!authObserverPromise) {
    authObserverPromise = import('@cloudbase/js-sdk').then((cloudbase) =>
      cloudbase.default
        .init({
          env: cloudConfig.envId,
          region: cloudConfig.region,
          persistence: 'local',
        })
        .auth(),
    );
  }
  return authObserverPromise;
}

function legacyEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const eventType = (payload as Record<string, unknown>).eventType;
  return typeof eventType === 'string' ? eventType.toLowerCase() : null;
}

/**
 * Subscribe to both the current v3 auth event and the v1 expiration signal.
 * SDK 3.7.1 only exposes unsubscribe for the v3 event; legacy callbacks are
 * therefore made inert on cleanup with the local `active` guard.
 */
export function subscribeToCloudAuth(
  observer: CloudAuthObserver,
  onSignal: (signal: CloudAuthSignal) => void,
): () => void {
  let active = true;
  const emit = (signal: CloudAuthSignal) => {
    if (active) onSignal(signal);
  };

  let unsubscribe: (() => void) | undefined;
  if (typeof observer.onAuthStateChange === 'function') {
    const result = observer.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        emit({ kind: 'SIGNED_OUT', reason: 'SIGNED_OUT' });
      } else if (event === 'SIGNED_IN') {
        emit({ kind: 'RECHECK', reason: 'SIGNED_IN' });
      } else if (event === 'INITIAL_SESSION') {
        emit({ kind: 'RECHECK', reason: 'INITIAL_SESSION' });
      } else if (event === 'USER_UPDATED' || event === 'BIND_IDENTITY') {
        emit({ kind: 'RECHECK', reason: 'USER_UPDATED' });
      }
      // TOKEN_REFRESHED keeps the same owner and does not need to hide/reload
      // an otherwise valid ledger.
    });
    unsubscribe = result?.data?.subscription?.unsubscribe;
  } else if (typeof observer.onLoginStateChanged === 'function') {
    // Compatibility path for SDK builds without the v3 subscription API.
    void observer.onLoginStateChanged((payload) => {
      const eventType = legacyEventType(payload);
      if (eventType === 'credentials_error' || eventType === 'sign_out') {
        emit({
          kind: 'SIGNED_OUT',
          reason: eventType === 'credentials_error' ? 'EXPIRED' : 'SIGNED_OUT',
        });
      } else {
        emit({ kind: 'RECHECK', reason: 'LEGACY_CHANGE' });
      }
    });
  }

  // credentials_error is a v1-only event in SDK 3.7.1 and is not forwarded to
  // onAuthStateChange, so keep this supplementary listener even on v3.
  if (typeof observer.onLoginStateExpired === 'function') {
    void observer.onLoginStateExpired(() => emit({ kind: 'SIGNED_OUT', reason: 'EXPIRED' }));
  }

  return () => {
    active = false;
    unsubscribe?.();
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(cloudEnabled ? 'CHECKING' : 'DISABLED');
  const [user, setUser] = useState<CloudUser | null>(null);
  const [store, setStore] = useState<CloudStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const userRef = useRef<CloudUser | null>(user);
  const authOperationRef = useRef(false);
  userRef.current = user;

  useEffect(() => {
    let active = true;
    let unsubscribeAuth: () => void = () => undefined;
    let sessionCheckTimer: ReturnType<typeof setInterval> | null = null;
    mountedRef.current = true;
    const deactivate = () => {
      active = false;
      unsubscribeAuth();
      if (sessionCheckTimer !== null) clearInterval(sessionCheckTimer);
      mountedRef.current = false;
      generationRef.current += 1;
    };
    if (!cloudEnabled) return deactivate;
    const initialGeneration = ++generationRef.current;
    const isCurrent = (generation: number) =>
      active && mountedRef.current && generationRef.current === generation;

    const applySignedOut = (reason: 'SIGNED_OUT' | 'EXPIRED') => {
      if (!active || !mountedRef.current) return;
      generationRef.current += 1;
      setUser(null);
      setError(reason === 'EXPIRED' ? '云端登录已失效，请重新登录' : null);
      setStatus('SIGNED_OUT');
    };

    const reconcileSession = (nextStore: CloudStore, hideUntilResolved: boolean) => {
      const generation = ++generationRef.current;
      if (hideUntilResolved) {
        // Clear the previous owner before an account switch can resolve. This
        // makes DataContext discard/isolate the old ledger immediately.
        setUser(null);
        setError(null);
        setStatus('CHECKING');
      }
      void withTimeout(
        nextStore.restoreSession(),
        AUTH_OPERATION_TIMEOUT_MS,
        '确认云端账号超时，请检查网络后重试',
      )
        .then((restored) => {
          if (!isCurrent(generation)) return;
          setUser(restored);
          setError(null);
          setStatus(restored ? 'SIGNED_IN' : 'SIGNED_OUT');
        })
        .catch((cause) => {
          if (!isCurrent(generation)) return;
          setUser(null);
          setError(describeError(cause));
          setStatus('ERROR');
        });
    };

    const restore = async () => {
      const nextStore = await getCloudStore();
      if (!nextStore) throw new Error('CloudBase 已启用，但账号服务没有正确初始化');
      if (!isCurrent(initialGeneration)) return null;
      setStore(nextStore);
      const restored = await nextStore.restoreSession();
      if (!isCurrent(initialGeneration)) return null;

      // The observer improves cross-tab responsiveness, but it must not turn a
      // healthy one-shot session check into a startup blocker. Polling remains
      // as the fallback when an SDK build or network blocks event setup.
      try {
        const observer = await getCloudAuthObserver();
        if (!isCurrent(initialGeneration)) return null;
        unsubscribeAuth = subscribeToCloudAuth(observer, (signal) => {
          if (authOperationRef.current) return;
          if (signal.kind === 'SIGNED_OUT') {
            applySignedOut(signal.reason);
          } else {
            reconcileSession(nextStore, true);
          }
        });
      } catch (cause) {
        console.warn('[CloudBase] 登录状态监听不可用，已降级为定时检查', cause);
      }
      sessionCheckTimer = setInterval(
        () => {
          if (userRef.current && !authOperationRef.current) reconcileSession(nextStore, false);
        },
        AUTH_SESSION_CHECK_INTERVAL_MS,
      );
      return { nextStore, restored };
    };

    void withTimeout(
      restore(),
      AUTH_OPERATION_TIMEOUT_MS,
      '连接云端账号超时，请检查网络后刷新页面',
    )
      .then((result) => {
        if (!result || !isCurrent(initialGeneration)) return;
        const { nextStore, restored } = result;
        setStore(nextStore);
        setUser(restored);
        setError(null);
        setStatus(restored ? 'SIGNED_IN' : 'SIGNED_OUT');

      })
      .catch((cause) => {
        if (!isCurrent(initialGeneration)) return;
        setUser(null);
        setError(describeError(cause));
        setStatus('ERROR');
      });
    return deactivate;
  }, []);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const generation = ++generationRef.current;
      const isCurrent = () => mountedRef.current && generationRef.current === generation;
      authOperationRef.current = true;
      if (isCurrent()) setError(null);
      try {
        const result = await withTimeout(
          (async () => {
            const nextStore = store ?? (await getCloudStore());
            if (!nextStore) throw new Error('CloudBase 账号服务没有正确初始化');
            const nextUser = await nextStore.signIn(username.trim(), password);
            return { nextStore, nextUser };
          })(),
          AUTH_OPERATION_TIMEOUT_MS,
          '登录超时，请检查网络后重试',
        );
        if (!isCurrent()) return;
        const { nextStore, nextUser } = result;
        setStore(nextStore);
        setUser(nextUser);
        setStatus('SIGNED_IN');
      } catch (cause) {
        if (!isCurrent()) return;
        const failure = asError(cause);
        setError(failure.message);
        // The login form already owns its busy state. Preserve the current
        // signed-in/out screen instead of replacing the entire app with the
        // session-restoration gate.
        throw failure;
      } finally {
        authOperationRef.current = false;
      }
    },
    [store],
  );

  const register = useCallback(
    async (username: string, password: string, inviteCode: string) => {
      const generation = ++generationRef.current;
      const isCurrent = () => mountedRef.current && generationRef.current === generation;
      authOperationRef.current = true;
      if (isCurrent()) setError(null);
      try {
        const result = await withTimeout(
          (async () => {
            const nextStore = store ?? (await getCloudStore());
            if (!nextStore) throw new Error('CloudBase 账号服务没有正确初始化');
            const nextUser = await nextStore.register(username.trim(), password, inviteCode.trim());
            return { nextStore, nextUser };
          })(),
          AUTH_OPERATION_TIMEOUT_MS,
          '注册超时，请检查网络后重试',
        );
        if (!isCurrent()) return;
        setStore(result.nextStore);
        setUser(result.nextUser);
        setError(null);
        setStatus('SIGNED_IN');
      } catch (cause) {
        if (!isCurrent()) return;
        const failure = asError(cause);
        setUser(null);
        setStatus('SIGNED_OUT');
        setError(failure.message);
        throw failure;
      } finally {
        authOperationRef.current = false;
      }
    },
    [store],
  );

  const signOut = useCallback(async () => {
    const generation = ++generationRef.current;
    const isCurrent = () => mountedRef.current && generationRef.current === generation;
    authOperationRef.current = true;
    if (isCurrent()) setError(null);
    try {
      const nextStore = await withTimeout(
        (async () => {
          const availableStore = store ?? (await getCloudStore());
          if (!availableStore) throw new Error('CloudBase 账号服务没有正确初始化');
          await availableStore.signOut();
          return availableStore;
        })(),
        AUTH_OPERATION_TIMEOUT_MS,
        '退出账号超时，请检查网络后重试',
      );
      if (!isCurrent()) return;
      setStore(nextStore);
      setUser(null);
      setError(null);
      setStatus(cloudEnabled ? 'SIGNED_OUT' : 'DISABLED');
    } catch (cause) {
      if (!isCurrent()) return;
      // A failed remote sign-out is not proof that the session ended. Keep the
      // current identity visible so personal data is never exposed as anonymous.
      const failure = new Error(`退出失败，账号仍可能保持登录，请重试：${describeError(cause)}`);
      setError(failure.message);
      throw failure;
    } finally {
      authOperationRef.current = false;
    }
  }, [store]);

  const value = useMemo<AuthContextValue>(
    () => ({ cloudEnabled, status, user, error, store, signIn, register, signOut }),
    [status, user, error, store, signIn, register, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

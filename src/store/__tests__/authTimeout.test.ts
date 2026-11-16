import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeToCloudAuth, withTimeout, type CloudAuthSignal } from '../AuthContext';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves normally and clears the pending timeout', async () => {
    await expect(withTimeout(Promise.resolve('ready'), 12_000, '超时')).resolves.toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the original rejection and clears the pending timeout', async () => {
    const failure = new Error('服务不可用');
    await expect(withTimeout(Promise.reject(failure), 12_000, '超时')).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a stalled operation with the product-facing timeout message', async () => {
    const pending = withTimeout(new Promise<void>(() => undefined), 12_000, '连接云端账号超时');
    const assertion = expect(pending).rejects.toThrow('连接云端账号超时');

    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
  });
});

describe('subscribeToCloudAuth', () => {
  it('maps v3 owner-changing events and ignores token-only refreshes', () => {
    let modernCallback: ((event: string) => void) | undefined;
    const unsubscribe = vi.fn();
    const signals: CloudAuthSignal[] = [];
    const stop = subscribeToCloudAuth(
      {
        onAuthStateChange(callback) {
          modernCallback = callback;
          return { data: { subscription: { unsubscribe } } };
        },
      },
      (signal) => signals.push(signal),
    );

    modernCallback?.('SIGNED_IN');
    modernCallback?.('TOKEN_REFRESHED');
    modernCallback?.('USER_UPDATED');
    modernCallback?.('SIGNED_OUT');

    expect(signals).toEqual([
      { kind: 'RECHECK', reason: 'SIGNED_IN' },
      { kind: 'RECHECK', reason: 'USER_UPDATED' },
      { kind: 'SIGNED_OUT', reason: 'SIGNED_OUT' },
    ]);

    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    modernCallback?.('SIGNED_IN');
    expect(signals).toHaveLength(3);
  });

  it('uses the expiration callback alongside v3 and makes it inert after cleanup', () => {
    let expiredCallback: (() => void) | undefined;
    const signals: CloudAuthSignal[] = [];
    const stop = subscribeToCloudAuth(
      {
        onAuthStateChange() {
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
        onLoginStateExpired(callback) {
          expiredCallback = callback;
        },
      },
      (signal) => signals.push(signal),
    );

    expiredCallback?.();
    expect(signals).toEqual([{ kind: 'SIGNED_OUT', reason: 'EXPIRED' }]);

    stop();
    expiredCallback?.();
    expect(signals).toHaveLength(1);
  });

  it('falls back to legacy login-state events when v3 is unavailable', () => {
    let legacyCallback: ((payload: unknown) => void) | undefined;
    const signals: CloudAuthSignal[] = [];
    subscribeToCloudAuth(
      {
        onLoginStateChanged(callback) {
          legacyCallback = callback;
        },
      },
      (signal) => signals.push(signal),
    );

    legacyCallback?.({ user: { uid: 'u-1' } });
    legacyCallback?.({ eventType: 'credentials_error' });
    legacyCallback?.({ eventType: 'sign_out' });

    expect(signals).toEqual([
      { kind: 'RECHECK', reason: 'LEGACY_CHANGE' },
      { kind: 'SIGNED_OUT', reason: 'EXPIRED' },
      { kind: 'SIGNED_OUT', reason: 'SIGNED_OUT' },
    ]);
  });
});

import type { LedgerPayload } from './types';
import {
  createLedgerOwnerCache,
  createSyncOutbox,
  mergeLedgerPayloadsThreeWay,
  parseLedgerOwnerCache,
  parseSyncOutbox,
  type LedgerOwnerCache,
  type SyncOutboxEntry,
} from './sync';

export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface JournalAcknowledgement {
  clean: boolean;
  payload: LedgerPayload;
  outbox: SyncOutboxEntry | null;
}

const PREFIX = 'dt:cloud-sync:v2';

function ownerKey(kind: 'cache' | 'outbox', ownerUid: string): string {
  return `${PREFIX}:${kind}:${encodeURIComponent(ownerUid)}`;
}

function storageError(action: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(`无法${action}本机待同步账本：${detail}`);
}

/**
 * Synchronous, owner-partitioned journal. `stage` writes the full outbox before React
 * updates or network debounce, so closing the page cannot discard an accepted edit.
 */
export class CloudSyncJournal {
  constructor(private readonly storage: SyncStorage) {}

  readCache(ownerUid: string): LedgerOwnerCache | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(ownerKey('cache', ownerUid));
    } catch (cause) {
      throw storageError('读取', cause);
    }
    if (!raw) return null;
    const parsed = parseLedgerOwnerCache(raw);
    if (!parsed.ok) {
      throw new Error(`本机云账本缓存已损坏：${parsed.issues.slice(0, 5).join('；')}`);
    }
    if (parsed.value.ownerUid !== ownerUid) {
      throw new Error('本机云账本缓存属于另一个账号，已停止读取');
    }
    return parsed.value;
  }

  readOutbox(ownerUid: string): SyncOutboxEntry | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(ownerKey('outbox', ownerUid));
    } catch (cause) {
      throw storageError('读取', cause);
    }
    if (!raw) return null;
    const parsed = parseSyncOutbox(raw);
    if (!parsed.ok) {
      throw new Error(`本机待同步记录已损坏：${parsed.issues.slice(0, 5).join('；')}`);
    }
    if (parsed.value.ownerUid !== ownerUid) {
      throw new Error('本机待同步记录属于另一个账号，已停止同步');
    }
    return parsed.value;
  }

  writeCache(ownerUid: string, payload: LedgerPayload): LedgerOwnerCache {
    const cache = createLedgerOwnerCache(ownerUid, payload);
    try {
      this.storage.setItem(ownerKey('cache', ownerUid), JSON.stringify(cache));
    } catch (cause) {
      throw storageError('保存', cause);
    }
    return cache;
  }

  /** Adds a newer local snapshot while retaining the original clean merge base. */
  stage(
    ownerUid: string,
    payload: LedgerPayload,
    cleanBase?: LedgerPayload | null,
    baseRevision = 0,
  ): SyncOutboxEntry {
    const existing = this.readOutbox(ownerUid);
    const outbox = createSyncOutbox({
      ownerUid,
      baseRevision: existing?.baseRevision ?? baseRevision,
      ...(existing?.basePayload
        ? { basePayload: existing.basePayload }
        : cleanBase
          ? { basePayload: cleanBase }
          : existing?.baseFingerprint
            ? { baseFingerprint: existing.baseFingerprint }
            : {}),
      payload,
      createdAt: existing?.createdAt,
    });
    try {
      // The outbox is the durability boundary; write it before the convenience cache.
      this.storage.setItem(ownerKey('outbox', ownerUid), JSON.stringify(outbox));
      this.storage.setItem(
        ownerKey('cache', ownerUid),
        JSON.stringify(createLedgerOwnerCache(ownerUid, payload)),
      );
    } catch (cause) {
      throw storageError('保存', cause);
    }
    return outbox;
  }

  /** Replaces the merge base after a fresh remote read or conflict resolution. */
  rebase(
    ownerUid: string,
    payload: LedgerPayload,
    cleanBase: LedgerPayload,
    baseRevision?: number,
  ): SyncOutboxEntry {
    const existing = this.readOutbox(ownerUid);
    const outbox = createSyncOutbox({
      ownerUid,
      baseRevision: baseRevision ?? existing?.baseRevision ?? 0,
      basePayload: cleanBase,
      payload,
      createdAt: existing?.createdAt,
    });
    try {
      this.storage.setItem(ownerKey('outbox', ownerUid), JSON.stringify(outbox));
      this.storage.setItem(
        ownerKey('cache', ownerUid),
        JSON.stringify(createLedgerOwnerCache(ownerUid, payload)),
      );
    } catch (cause) {
      throw storageError('保存', cause);
    }
    return outbox;
  }

  /**
   * Acknowledges only the exact sent outbox. If the user edited again while the request
   * was in flight, the newer outbox survives and is rebased onto the server response.
   */
  acknowledge(
    ownerUid: string,
    sentOutbox: SyncOutboxEntry,
    savedPayload: LedgerPayload,
    savedRevision?: number,
  ): JournalAcknowledgement {
    const current = this.readOutbox(ownerUid);
    if (current && current.fingerprint !== sentOutbox.fingerprint) {
      const rebased = mergeLedgerPayloadsThreeWay(
        sentOutbox.payload,
        current.payload,
        savedPayload,
        { prefer: 'local' },
      ).payload;
      const outbox = this.rebase(ownerUid, rebased, savedPayload, savedRevision);
      return { clean: false, payload: rebased, outbox };
    }

    const cache = createLedgerOwnerCache(ownerUid, savedPayload);
    try {
      this.storage.setItem(ownerKey('cache', ownerUid), JSON.stringify(cache));
      this.storage.removeItem(ownerKey('outbox', ownerUid));
    } catch (cause) {
      throw storageError('确认', cause);
    }
    return { clean: true, payload: savedPayload, outbox: null };
  }

  acceptRemote(ownerUid: string, payload: LedgerPayload): void {
    const cache = createLedgerOwnerCache(ownerUid, payload);
    try {
      this.storage.setItem(ownerKey('cache', ownerUid), JSON.stringify(cache));
      this.storage.removeItem(ownerKey('outbox', ownerUid));
    } catch (cause) {
      throw storageError('保存', cause);
    }
  }
}

export const cloudSyncJournalKeys = {
  cache: (ownerUid: string) => ownerKey('cache', ownerUid),
  outbox: (ownerUid: string) => ownerKey('outbox', ownerUid),
};

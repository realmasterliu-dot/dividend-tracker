import type { AppSettings, DataState } from '@/types';

/** 云端只保存个人账本，不复制可重新拉取的行情与汇率。 */
export interface LedgerPayload {
  schemaVersion: 1;
  instruments: DataState['instruments'];
  transactions: DataState['transactions'];
  plans: DataState['plans'];
  dividends: DataState['dividends'];
  notifications: DataState['notifications'];
  settings: AppSettings;
  updatedAt: string;
}

export interface CloudUser {
  uid: string;
  username?: string;
  email?: string;
}

export interface CloudLedgerSnapshot {
  payload: LedgerPayload;
  revision: number;
}

export interface CloudLedgerDocument {
  _id?: string;
  _openid?: string;
  /** Absent only on legacy documents created before owner-bound CAS sync. */
  ownerUid?: string;
  ledgerKey: 'primary';
  payload: LedgerPayload;
  /** Absent only on legacy documents; legacy loads expose revision 0. */
  revision?: number;
  updatedAt: string;
}

export interface CloudStore {
  restoreSession(): Promise<CloudUser | null>;
  signIn(username: string, password: string): Promise<CloudUser>;
  register(username: string, password: string, inviteCode: string): Promise<CloudUser>;
  signOut(): Promise<void>;
  load(expectedUid: string): Promise<CloudLedgerSnapshot | null>;
  save(
    payload: LedgerPayload,
    expectedUid: string,
    expectedRevision: number | null,
  ): Promise<CloudLedgerSnapshot>;
}

import { describe, expect, it } from 'vitest';
import type { AppSettings, Instrument, Transaction } from '@/types';
import type { LedgerPayload } from '../types';
import { CloudSyncJournal, cloudSyncJournalKeys, type SyncStorage } from '../journal';

class MemoryStorage implements SyncStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

const settings: AppSettings = {
  baseCurrency: 'CNY',
  displayCurrency: 'CNY',
  colorScheme: 'CN',
  w8benFilled: false,
  fxNeutralMode: false,
  notificationChannels: {},
  stalenessThresholdHours: 48,
};

const instrument = (id: string): Instrument => ({
  id,
  symbol: id,
  name: id,
  market: 'A_SHARE',
  currency: 'CNY',
  dividendEligible: true,
  securityType: 'COMMON',
  extraWithholdingRate: 0,
  custodyChannel: 'CN_BROKER',
});

const transaction = (id: string): Transaction => ({
  id,
  instrumentId: 'a',
  type: 'BUY',
  status: 'CONFIRMED',
  date: '2026-08-12',
  quantity: 1,
  price: 10,
  amount: 10,
  currency: 'CNY',
  fxRate: 1,
});

const payload = (overrides: Partial<LedgerPayload> = {}): LedgerPayload => ({
  schemaVersion: 1,
  instruments: [],
  transactions: [],
  plans: [],
  dividends: [],
  notifications: [],
  settings,
  updatedAt: '2026-08-12T00:00:00.000Z',
  ...overrides,
});

describe('CloudSyncJournal', () => {
  it('durably stages an edit synchronously before any network call', () => {
    const storage = new MemoryStorage();
    const journal = new CloudSyncJournal(storage);
    const base = payload();
    const edited = payload({ transactions: [transaction('new')] });
    journal.stage('alice', edited, base);

    expect(journal.readOutbox('alice')?.payload.transactions).toHaveLength(1);
    expect(journal.readCache('alice')?.payload.transactions).toHaveLength(1);
  });

  it('partitions cache and outbox by owner', () => {
    const storage = new MemoryStorage();
    const journal = new CloudSyncJournal(storage);
    journal.stage('alice', payload({ instruments: [instrument('a')] }), payload());
    journal.stage('bob', payload({ instruments: [instrument('b')] }), payload());

    expect(journal.readOutbox('alice')?.payload.instruments[0].id).toBe('a');
    expect(journal.readOutbox('bob')?.payload.instruments[0].id).toBe('b');
    expect(cloudSyncJournalKeys.outbox('alice')).not.toBe(cloudSyncJournalKeys.outbox('bob'));
  });

  it('does not clear a newer edit when an older request is acknowledged', () => {
    const storage = new MemoryStorage();
    const journal = new CloudSyncJournal(storage);
    const base = payload();
    const first = journal.stage('alice', payload({ transactions: [transaction('first')] }), base);
    journal.stage(
      'alice',
      payload({ transactions: [transaction('first'), transaction('second')] }),
      base,
    );

    const result = journal.acknowledge('alice', first, first.payload);
    expect(result.clean).toBe(false);
    expect(result.payload.transactions.map((item) => item.id)).toEqual(['first', 'second']);
    expect(journal.readOutbox('alice')?.payload.transactions).toHaveLength(2);
  });

  it('rebases a newer local edit onto remote additions retained by the saved payload', () => {
    const storage = new MemoryStorage();
    const journal = new CloudSyncJournal(storage);
    const base = payload();
    const first = journal.stage('alice', payload({ instruments: [instrument('local')] }), base);
    journal.stage(
      'alice',
      payload({ instruments: [instrument('local')], transactions: [transaction('later')] }),
      base,
    );
    const saved = payload({ instruments: [instrument('local'), instrument('remote')] });

    const result = journal.acknowledge('alice', first, saved);
    expect(result.clean).toBe(false);
    expect(result.payload.instruments.map((item) => item.id)).toEqual(['local', 'remote']);
    expect(result.payload.transactions.map((item) => item.id)).toEqual(['later']);
  });

  it('clears only the matching outbox after a successful acknowledgement', () => {
    const storage = new MemoryStorage();
    const journal = new CloudSyncJournal(storage);
    const staged = journal.stage('alice', payload({ instruments: [instrument('a')] }), payload());
    const result = journal.acknowledge('alice', staged, staged.payload);

    expect(result.clean).toBe(true);
    expect(journal.readOutbox('alice')).toBeNull();
    expect(journal.readCache('alice')?.payload.instruments[0].id).toBe('a');
  });

  it('rejects corrupt or cross-owner journal values instead of overwriting them', () => {
    const storage = new MemoryStorage();
    const journal = new CloudSyncJournal(storage);
    storage.setItem(cloudSyncJournalKeys.outbox('alice'), '{');
    expect(() => journal.readOutbox('alice')).toThrow('已损坏');

    storage.data.clear();
    const bob = journal.stage('bob', payload(), payload());
    storage.setItem(cloudSyncJournalKeys.outbox('alice'), JSON.stringify(bob));
    expect(() => journal.readOutbox('alice')).toThrow('属于另一个账号');
  });
});

import { describe, expect, it } from 'vitest';
import type { LedgerPayload } from '@/data/cloud/types';
import {
  downloadLedgerBackup,
  LEDGER_BACKUP_VERSION,
  parseLedgerBackup,
} from '../personalData';

const ledger: LedgerPayload = {
  schemaVersion: 1,
  instruments: [{
    id: 'AAPL', symbol: 'AAPL', name: 'Apple', market: 'US', currency: 'USD',
    dividendEligible: true, securityType: 'COMMON', extraWithholdingRate: 0,
    custodyChannel: 'US_BROKER',
  }],
  transactions: [{
    id: 'cash', instrumentId: 'AAPL', type: 'DIVIDEND_CASH', status: 'CONFIRMED',
    date: '2026-08-12', quantity: 0, price: 0, amount: 10, currency: 'USD', fxRate: 7,
    meta: { dividendEventId: 'manual-dividend' },
  }],
  plans: [],
  dividends: [{
    id: 'manual-dividend', instrumentId: 'AAPL', status: 'RECONCILED',
    payDate: '2026-08-12', payDateEstimated: false, perShareAmount: 0.25,
    currency: 'USD', quantityAtRecord: 40, grossAmount: 70, taxRateApplied: 0,
    taxWithheld: 0, contingentTax: 0, netAmount: 70, actualReceived: 70,
    taxBracket: 'NONE', dividendForm: 'CASH', manual: true,
    sourceKey: 'manual-transaction:cash', taxWithheldOverride: 2,
  }],
  notifications: [{
    id: 'manual-note', key: 'manual-note', type: 'DATA_STALE', title: '已读提醒',
    body: '已读提醒', severity: 'INFO', createdAt: '2026-08-12T00:00:00.000Z', read: true,
  }],
  settings: {
    baseCurrency: 'CNY', displayCurrency: 'USD', colorScheme: 'COLORBLIND',
    w8benFilled: true, fxNeutralMode: true, annualIncomeTarget: 10_000,
    notificationChannels: {}, stalenessThresholdHours: 72,
  },
  updatedAt: '2026-08-12T00:00:00.000Z',
};

describe('complete ledger backup', () => {
  it('round-trips every durable slice, correction and setting', () => {
    const raw = JSON.parse(downloadLedgerBackup(ledger)) as { version: number };
    expect(raw.version).toBe(LEDGER_BACKUP_VERSION);
    expect(parseLedgerBackup(raw)).toEqual(ledger);
  });

  it('allows an empty but valid complete ledger and keeps legacy files distinguishable', () => {
    const empty = { ...ledger, instruments: [], transactions: [], dividends: [], notifications: [] };
    expect(parseLedgerBackup(JSON.parse(downloadLedgerBackup(empty)))).toEqual(empty);
    expect(parseLedgerBackup({ version: 1, instruments: [] })).toBeNull();
  });

  it('rejects a corrupted v2 backup instead of partially restoring it', () => {
    expect(() => parseLedgerBackup({
      version: LEDGER_BACKUP_VERSION,
      ledger: { ...ledger, dividends: 'broken' },
    })).toThrow('完整账本备份已损坏');
  });
});

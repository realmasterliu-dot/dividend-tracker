import { cloudEnabled } from '@/config/cloud';
import type { CloudStore } from './types';

export type { CloudStore, CloudUser, LedgerPayload } from './types';

export async function getCloudStore(): Promise<CloudStore | null> {
  if (!cloudEnabled) return null;
  const { cloudbaseStore } = await import('./cloudbaseStore');
  return cloudbaseStore;
}


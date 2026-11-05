export interface OfflineQueuedMutation {
  id: string;
  path: string;
  init: RequestInit;
  createdAt: string;
}

interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isQueuedMutation(value: unknown): value is OfflineQueuedMutation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<OfflineQueuedMutation>;
  return typeof item.id === 'string' && item.id.length > 0 &&
    typeof item.path === 'string' && item.path.startsWith('/api/') &&
    !!item.init && typeof item.init === 'object' &&
    typeof item.createdAt === 'string';
}

function itemKey(prefix: string, id: string) {
  return `${prefix}${encodeURIComponent(id)}`;
}

function migrateLegacyQueue(storage: KeyValueStorage, legacyKey: string, itemPrefix: string) {
  const raw = storage.getItem(legacyKey);
  if (!raw) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(parsed)) return;
  for (const item of parsed) {
    if (!isQueuedMutation(item)) continue;
    const key = itemKey(itemPrefix, item.id);
    if (!storage.getItem(key)) storage.setItem(key, JSON.stringify(item));
  }
  storage.removeItem(legacyKey);
}

export function enqueueOfflineMutation(storage: KeyValueStorage, legacyKey: string, itemPrefix: string, item: OfflineQueuedMutation) {
  if (!isQueuedMutation(item)) throw new Error('عملية المزامنة المحلية غير صالحة.');
  migrateLegacyQueue(storage, legacyKey, itemPrefix);
  storage.setItem(itemKey(itemPrefix, item.id), JSON.stringify(item));
}

export function readOfflineMutations(storage: KeyValueStorage, legacyKey: string, itemPrefix: string): OfflineQueuedMutation[] {
  migrateLegacyQueue(storage, legacyKey, itemPrefix);
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(itemPrefix)) keys.push(key);
  }
  const byId = new Map<string, OfflineQueuedMutation>();
  for (const key of keys) {
    try {
      const item: unknown = JSON.parse(storage.getItem(key) || 'null');
      if (isQueuedMutation(item)) byId.set(item.id, item);
    } catch {
      // Preserve malformed entries for diagnosis; other valid operations remain readable.
    }
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function removeOfflineMutation(storage: KeyValueStorage, itemPrefix: string, id: string) {
  storage.removeItem(itemKey(itemPrefix, id));
}

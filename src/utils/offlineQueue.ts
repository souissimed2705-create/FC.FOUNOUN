export interface OfflineMutationInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

export interface OfflineMutation {
  id: string;
  userId: string;
  path: string;
  init: OfflineMutationInit;
  createdAt: string;
}

const DB_NAME = 'fc-founoun-operations-queue';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';
const LEGACY_QUEUE_PREFIX = 'fc-founoun-offline-operations-v2';

function openQueueDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('التخزين المحلي الآمن غير متاح؛ لم تُحفظ العملية حتى لا تضيع.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('تعذر فتح مخزن المزامنة المحلي.'));
    request.onblocked = () => reject(new Error('مخزن المزامنة قيد الاستخدام في تبويب آخر؛ أغلق التبويبات القديمة ثم أعد المحاولة.'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('فشلت عملية التخزين المحلي.'));
    tx.onabort = () => reject(tx.error || new Error('أُلغيت عملية التخزين المحلي.'));
  });
}

export function normalizeMutationInit(init: RequestInit): OfflineMutationInit {
  if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
    throw new Error('نوع بيانات العملية غير قابل للحفظ دون اتصال.');
  }
  const headers: Record<string, string> = {};
  if (init.headers instanceof Headers) {
    init.headers.forEach((value, key) => { headers[key] = value; });
  } else if (Array.isArray(init.headers)) {
    for (const [key, value] of init.headers) headers[key] = value;
  } else if (init.headers) {
    Object.assign(headers, init.headers as Record<string, string>);
  }
  return {
    ...(init.method ? { method: init.method } : {}),
    ...(typeof init.body === 'string' ? { body: init.body } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  };
}

async function migrateLegacyQueue(db: IDBDatabase, userId: string): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const legacyKey = `${LEGACY_QUEUE_PREFIX}:${userId}`;
  let raw: string | null = null;
  try { raw = localStorage.getItem(legacyKey); } catch { return; }
  if (!raw) return;
  let legacy: unknown;
  try { legacy = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(legacy)) return;
  const valid: OfflineMutation[] = [];
  for (const item of legacy) {
    if (!item || typeof item.id !== 'string' || typeof item.path !== 'string' ||
        !item.path.startsWith('/api/') || typeof item.createdAt !== 'string' ||
        !item.init || typeof item.init !== 'object') continue;
    try {
      valid.push({ id: item.id, userId, path: item.path, init: normalizeMutationInit(item.init), createdAt: item.createdAt });
    } catch { /* Keep malformed legacy entries in the old key for recovery. */ }
  }
  if (!valid.length) return;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  for (const item of valid) store.put(item);
  await transactionDone(tx);
  try {
    if (valid.length === legacy.length) localStorage.removeItem(legacyKey);
    else localStorage.setItem(legacyKey, JSON.stringify(legacy.filter(item => !valid.some(saved => saved.id === item?.id))));
  } catch { /* The IndexedDB copy is already durable; a later migration pass is idempotent. */ }
}

export async function enqueueOfflineMutation(userId: string, path: string, init: RequestInit): Promise<void> {
  if (!userId) throw new Error('يجب تسجيل الدخول قبل حفظ عملية دون اتصال.');
  if (typeof path !== 'string' || !path.startsWith('/api/')) throw new Error('مسار العملية غير صالح للحفظ المحلي.');
  const db = await openQueueDatabase();
  try {
    await migrateLegacyQueue(db, userId);
    const item: OfflineMutation = {
      id: crypto.randomUUID(),
      userId,
      path,
      init: normalizeMutationInit(init),
      createdAt: new Date().toISOString(),
    };
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(item);
    await transactionDone(tx);
  } finally { db.close(); }
}

export async function listOfflineMutations(userId: string): Promise<OfflineMutation[]> {
  if (!userId) return [];
  const db = await openQueueDatabase();
  try {
    await migrateLegacyQueue(db, userId);
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).index('userId').getAll(userId);
    const rows = await new Promise<OfflineMutation[]>((resolve, reject) => {
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error || new Error('تعذر قراءة العمليات المحفوظة.'));
    });
    await transactionDone(tx);
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } finally { db.close(); }
}

export async function deleteOfflineMutation(id: string): Promise<void> {
  const db = await openQueueDatabase();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await transactionDone(tx);
  } finally { db.close(); }
}

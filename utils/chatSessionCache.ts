import { ChatSession } from '../types';

const DB_NAME = 'dayflow_local_cache';
const DB_VERSION = 1;
const CHAT_SESSION_STORE = 'chat_sessions_by_user';

type ChatSessionCacheRow = {
  userId: string;
  sessions: ChatSession[];
  updatedAt: string;
};

const isIndexedDbAvailable = (): boolean => typeof indexedDB !== 'undefined';

const openCacheDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (!isIndexedDbAvailable()) {
    reject(new Error('IndexedDB is not available in this environment.'));
    return;
  }

  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(CHAT_SESSION_STORE)) {
      db.createObjectStore(CHAT_SESSION_STORE, { keyPath: 'userId' });
    }
  };

  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
});

const runTransaction = async <T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => Promise<T>
): Promise<T> => {
  const db = await openCacheDb();
  try {
    const transaction = db.transaction(CHAT_SESSION_STORE, mode);
    const store = transaction.objectStore(CHAT_SESSION_STORE);
    const result = await handler(store);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    });
    return result;
  } finally {
    db.close();
  }
};

export const loadChatSessionsCache = async (userId: string): Promise<ChatSession[] | null> => {
  if (!userId || !isIndexedDbAvailable()) return null;
  try {
    return await runTransaction('readonly', (store) =>
      new Promise<ChatSession[] | null>((resolve, reject) => {
        const request = store.get(userId);
        request.onsuccess = () => {
          const row = request.result as ChatSessionCacheRow | undefined;
          resolve(Array.isArray(row?.sessions) ? row!.sessions : null);
        };
        request.onerror = () => reject(request.error ?? new Error('Failed to read chat cache.'));
      })
    );
  } catch {
    return null;
  }
};

export const saveChatSessionsCache = async (userId: string, sessions: ChatSession[]): Promise<void> => {
  if (!userId || !isIndexedDbAvailable()) return;
  try {
    await runTransaction('readwrite', (store) =>
      new Promise<void>((resolve, reject) => {
        const payload: ChatSessionCacheRow = {
          userId,
          sessions,
          updatedAt: new Date().toISOString(),
        };
        const request = store.put(payload);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('Failed to write chat cache.'));
      })
    );
  } catch {
    // Ignore cache persistence errors.
  }
};

export const clearChatSessionsCache = async (userId: string): Promise<void> => {
  if (!userId || !isIndexedDbAvailable()) return;
  try {
    await runTransaction('readwrite', (store) =>
      new Promise<void>((resolve, reject) => {
        const request = store.delete(userId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('Failed to clear chat cache.'));
      })
    );
  } catch {
    // Ignore cache cleanup errors.
  }
};

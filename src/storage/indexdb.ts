import type { Page, ChatMessage } from "../types/messages";

const DB_NAME = "pageai_extension";
const DB_VERSION = 5;
const PAGES_STORE = "pages";
const CHAT_HISTORY_STORE = "chat_history";
const LLM_CACHE_STORE = "llm_cache";

export interface LlmCacheEntry {
  id?: number;
  query: string;
  response: string;
  timestamp: number;
  ttl: number; // milliseconds
}

export class Storage {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = this.open();
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PAGES_STORE)) {
          const store = db.createObjectStore(PAGES_STORE, { keyPath: "id" });
          store.createIndex("by_updatedAt", "updatedAt");
          store.createIndex("by_spaceKey", "spaceKey");
        }
        if (!db.objectStoreNames.contains(CHAT_HISTORY_STORE)) {
          const store = db.createObjectStore(CHAT_HISTORY_STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("by_timestamp", "timestamp");
        }
        if (!db.objectStoreNames.contains(LLM_CACHE_STORE)) {
          const store = db.createObjectStore(LLM_CACHE_STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("by_query", "query", { unique: false });
          store.createIndex("by_timestamp", "timestamp");
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async savePage(page: Page): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PAGES_STORE, "readwrite");
      const store = tx.objectStore(PAGES_STORE);
      store.put(page);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllPages(): Promise<Page[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PAGES_STORE, "readonly");
      const store = tx.objectStore(PAGES_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result as Page[]);
      request.onerror = () => reject(request.error);
    });
  }

  async getPagesByIds(ids: string[]): Promise<Page[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PAGES_STORE, "readonly");
      const store = tx.objectStore(PAGES_STORE);
      const results: Page[] = [];

      ids.forEach((id) => {
        const request = store.get(id);
        request.onsuccess = () => {
          if (request.result) {
            results.push(request.result as Page);
          }
        };
        request.onerror = () => reject(request.error);
      });

      tx.oncomplete = () => resolve(results);
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveChatMessage(message: ChatMessage): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHAT_HISTORY_STORE, "readwrite");
      const store = tx.objectStore(CHAT_HISTORY_STORE);
      store.add(message);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getChatHistory(): Promise<ChatMessage[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHAT_HISTORY_STORE, "readonly");
      const store = tx.objectStore(CHAT_HISTORY_STORE);
      const index = store.index("by_timestamp");
      const request = index.getAll();

      request.onsuccess = () => resolve(request.result as ChatMessage[]);
      request.onerror = () => reject(request.error);
    });
  }

  async clearChatHistory(): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHAT_HISTORY_STORE, "readwrite");
      const store = tx.objectStore(CHAT_HISTORY_STORE);
      const request = store.clear();

      request.onsuccess = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Функции для работы с LLM кешем (как отдельные функции для простоты)
export async function getCachedLlmResponse(query: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(LLM_CACHE_STORE, "readonly");
        const store = tx.objectStore(LLM_CACHE_STORE);
        const index = store.index("by_query");

        const getRequest = index.get(query);
        getRequest.onsuccess = () => {
          const entry = getRequest.result as LlmCacheEntry | undefined;
          if (!entry) {
            resolve(null);
            return;
          }

          // Проверить TTL
          const now = Date.now();
          if (now - entry.timestamp > entry.ttl) {
            // Кеш истёк, удалить и вернуть null
            const deleteRequest = store.delete(entry.id!);
            deleteRequest.onsuccess = () => resolve(null);
          } else {
            resolve(entry.response);
          }
        };

        getRequest.onerror = () => resolve(null);
      };

      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setCachedLlmResponse(
  query: string,
  response: string,
  ttlMs: number = 24 * 60 * 60 * 1000 // 24 часа по умолчанию
): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(LLM_CACHE_STORE, "readwrite");
        const store = tx.objectStore(LLM_CACHE_STORE);

        const entry: LlmCacheEntry = {
          query,
          response,
          timestamp: Date.now(),
          ttl: ttlMs
        };

        const putRequest = store.add(entry);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => resolve();
      };

      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearLlmCache(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(LLM_CACHE_STORE, "readwrite");
        const store = tx.objectStore(LLM_CACHE_STORE);
        const clearRequest = store.clear();

        clearRequest.onsuccess = () => resolve();
        clearRequest.onerror = () => resolve();
      };

      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

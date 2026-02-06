import type { ConfluencePage } from "../types/messages";

const DB_NAME = "confluence_ai_extension";
const DB_VERSION = 1;
const PAGES_STORE = "pages";

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
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async savePage(page: ConfluencePage): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PAGES_STORE, "readwrite");
      const store = tx.objectStore(PAGES_STORE);
      store.put(page);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllPages(): Promise<ConfluencePage[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PAGES_STORE, "readonly");
      const store = tx.objectStore(PAGES_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result as ConfluencePage[]);
      request.onerror = () => reject(request.error);
    });
  }

  async getPagesByIds(ids: string[]): Promise<ConfluencePage[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PAGES_STORE, "readonly");
      const store = tx.objectStore(PAGES_STORE);
      const results: ConfluencePage[] = [];

      ids.forEach((id) => {
        const request = store.get(id);
        request.onsuccess = () => {
          if (request.result) {
            results.push(request.result as ConfluencePage);
          }
        };
        request.onerror = () => reject(request.error);
      });

      tx.oncomplete = () => resolve(results);
      tx.onerror = () => reject(tx.error);
    });
  }
}


import { MemoryStorage, type StorageAdapter } from './StorageAdapter';

/**
 * Web: localStorage. expo-sqlite on web is alpha and needs wasm + COOP/COEP
 * headers, so the browser uses this adapter with the same SaveManager logic.
 * localStorage writes are synchronous, so setMany cannot be torn mid-way by
 * the page itself; SaveManager adds checksum + backup for other failures.
 */
class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'localStorage';
  async getItem(key: string): Promise<string | null> {
    return window.localStorage.getItem(key);
  }
  async setItem(key: string, value: string): Promise<void> {
    window.localStorage.setItem(key, value);
  }
  async removeItem(key: string): Promise<void> {
    window.localStorage.removeItem(key);
  }
  async setMany(entries: [string, string][]): Promise<void> {
    for (const [k, v] of entries) window.localStorage.setItem(k, v);
  }
}

export function createStorage(): StorageAdapter {
  try {
    const k = '__legends_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return new LocalStorageAdapter();
  } catch {
    return new MemoryStorage();
  }
}

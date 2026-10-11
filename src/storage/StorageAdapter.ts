/** Minimal async key-value contract implemented per platform. */
export interface StorageAdapter {
  readonly name: string;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Writes several keys atomically when the backend supports it. */
  setMany(entries: [string, string][]): Promise<void>;
}

export class MemoryStorage implements StorageAdapter {
  readonly name = 'memory';
  data = new Map<string, string>();
  failNextWrite = false;
  async getItem(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('simulated write failure');
    }
    this.data.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.data.delete(key);
  }
  async setMany(entries: [string, string][]): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('simulated write failure');
    }
    for (const [k, v] of entries) this.data.set(k, v);
  }
}

import * as SQLite from 'expo-sqlite';
import type { StorageAdapter } from './StorageAdapter';

/**
 * Native (Android/iOS): SQLite key-value table. Multi-key writes run inside an
 * exclusive transaction so a save is either fully written or not at all.
 * Web uses createStorage.web.ts (Metro platform extension).
 */
class SqliteStorage implements StorageAdapter {
  readonly name = 'expo-sqlite';
  private db: Promise<SQLite.SQLiteDatabase>;

  constructor() {
    this.db = SQLite.openDatabaseAsync('legends_rpg.db').then(async (db) => {
      await db.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);');
      return db;
    });
  }

  async getItem(key: string): Promise<string | null> {
    const db = await this.db;
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    return row?.value ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.setMany([[key, value]]);
  }

  async removeItem(key: string): Promise<void> {
    const db = await this.db;
    await db.runAsync('DELETE FROM kv WHERE key = ?', key);
  }

  async setMany(entries: [string, string][]): Promise<void> {
    const db = await this.db;
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const [k, v] of entries) await txn.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', k, v);
    });
  }
}

export function createStorage(): StorageAdapter {
  return new SqliteStorage();
}

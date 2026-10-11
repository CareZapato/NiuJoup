import type { StorageAdapter } from '../../../storage/StorageAdapter';
import { checksum, migrate, type SaveData } from './saveSchema';

export const SAVE_KEYS = {
  main: 'legends.save.main',
  backup: 'legends.save.backup',
  settings: 'legends.settings',
} as const;

interface Envelope {
  checksum: string;
  payload: string;
}

export type LoadResult = { data: SaveData; source: 'main' | 'backup' } | { data: null; source: null; error?: string };

export function decodeEnvelope(raw: string | null): SaveData {
  if (!raw) throw new Error('empty');
  const env = JSON.parse(raw) as Envelope;
  if (typeof env.payload !== 'string' || typeof env.checksum !== 'string') throw new Error('bad envelope');
  if (checksum(env.payload) !== env.checksum) throw new Error('checksum mismatch');
  return migrate(JSON.parse(env.payload) as Record<string, unknown>);
}

export function encodeEnvelope(data: SaveData): string {
  const payload = JSON.stringify(data);
  return JSON.stringify({ checksum: checksum(payload), payload } satisfies Envelope);
}

/**
 * Autosave pipeline: debounced requests -> snapshot -> atomic write of
 * (backup = previous main, main = new) -> read-back verification. A save is
 * only reported as complete after verification succeeds.
 */
export class SaveManager {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<boolean> | null = null;
  private pendingReason: string | null = null;
  lastSaveOk: boolean | null = null;
  lastSavedAt = 0;

  constructor(
    private storage: StorageAdapter,
    private snapshot: () => SaveData | null,
    private onSaved: (ok: boolean, reason: string, error?: string) => void,
    private debounceMs = 800,
  ) {}

  get backendName(): string {
    return this.storage.name;
  }

  request(reason: string, immediate = false): void {
    this.pendingReason = this.pendingReason ? `${this.pendingReason}, ${reason}` : reason;
    if (this.timer) clearTimeout(this.timer);
    if (immediate) {
      this.timer = null;
      void this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Writes any pending request now (used on app suspend). */
  async flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.writing) await this.writing;
    const reason = this.pendingReason;
    if (!reason) return this.lastSaveOk ?? true;
    this.pendingReason = null;
    const data = this.snapshot();
    if (!data) return false;
    this.writing = this.write(data, reason);
    const ok = await this.writing;
    this.writing = null;
    return ok;
  }

  async write(data: SaveData, reason = 'manual'): Promise<boolean> {
    try {
      const encoded = encodeEnvelope(data);
      const previous = await this.storage.getItem(SAVE_KEYS.main);
      const entries: [string, string][] = [];
      if (previous && this.isValid(previous)) entries.push([SAVE_KEYS.backup, previous]);
      entries.push([SAVE_KEYS.main, encoded]);
      await this.storage.setMany(entries);
      const readBack = await this.storage.getItem(SAVE_KEYS.main);
      if (readBack !== encoded) throw new Error('verification failed');
      this.lastSaveOk = true;
      this.lastSavedAt = Date.now();
      this.onSaved(true, reason);
      return true;
    } catch (e) {
      this.lastSaveOk = false;
      this.onSaved(false, reason, String(e));
      return false;
    }
  }

  private isValid(raw: string): boolean {
    try {
      decodeEnvelope(raw);
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<LoadResult> {
    let error: string | undefined;
    try {
      return { data: decodeEnvelope(await this.storage.getItem(SAVE_KEYS.main)), source: 'main' };
    } catch (e) {
      error = String(e);
    }
    try {
      return { data: decodeEnvelope(await this.storage.getItem(SAVE_KEYS.backup)), source: 'backup' };
    } catch {
      /* fall through */
    }
    return { data: null, source: null, error };
  }

  async hasSave(): Promise<boolean> {
    const r = await this.load();
    return r.data !== null;
  }

  async clear(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingReason = null;
    await this.storage.removeItem(SAVE_KEYS.main);
    await this.storage.removeItem(SAVE_KEYS.backup);
  }
}

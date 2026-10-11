import { describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../../storage/StorageAdapter';
import { Game } from '../Game';
import { checksum, migrate, type SaveData, type SaveDataV1, validate } from '../systems/persistence/saveSchema';
import { decodeEnvelope, encodeEnvelope, SAVE_KEYS, SaveManager } from '../systems/persistence/SaveManager';

function sampleSave(): SaveData {
  const g = new Game();
  g.newGame('kaien');
  return g.toSave()!;
}

describe('save schema', () => {
  it('round-trips through the checksummed envelope', () => {
    const s = sampleSave();
    expect(decodeEnvelope(encodeEnvelope(s))).toEqual(s);
  });

  it('detects corruption via checksum', () => {
    const raw = encodeEnvelope(sampleSave());
    const env = JSON.parse(raw) as { checksum: string; payload: string };
    env.payload = env.payload.replace('"money":50', '"money":99999');
    expect(() => decodeEnvelope(JSON.stringify(env))).toThrow(/checksum/);
    expect(() => decodeEnvelope(raw.slice(0, raw.length / 2))).toThrow();
    expect(checksum('abc')).not.toBe(checksum('abd'));
  });

  it('migrates a v1 save to the current version', () => {
    const v1: SaveDataV1 = {
      version: 1,
      savedAt: 1,
      party: [
        { id: 'suri', level: 4, xp: 50, ap: 2, skills: ['combo_basics'] },
        { id: 'kaien', level: 3, xp: 0, ap: 0, skills: [] },
      ],
      gold: 321,
      items: { herb: 3 },
      position: { x: 10, z: 12 },
      flags: ['chest:chest_village', 'boss:e_golem'],
    };
    const d = migrate(v1 as unknown as Record<string, unknown>);
    expect(d.version).toBe(2);
    expect(d.leader).toBe('suri');
    expect(d.roster.suri.skills).toEqual({ combo_basics: 1 });
    expect(d.money).toBe(321);
    expect(d.world.openedChests).toEqual(['chest_village']);
    expect(d.world.defeatedPersistent).toEqual(['e_golem']);
  });

  it('rejects invalid or future saves', () => {
    expect(() => migrate({ version: 99 })).toThrow(/newer/);
    const bad = { ...sampleSave(), partyOrder: [] } as unknown as Record<string, unknown>;
    expect(() => validate(bad)).toThrow(/partyOrder/);
  });
});

describe('SaveManager', () => {
  it('only reports success after a verified write, and keeps a backup of the previous save', async () => {
    const storage = new MemoryStorage();
    let n = 0;
    const onSaved = vi.fn();
    const sm = new SaveManager(storage, () => ({ ...sampleSave(), money: ++n }), onSaved, 10);
    sm.request('a', true);
    expect(await sm.flush()).toBe(true);
    expect(onSaved).toHaveBeenLastCalledWith(true, 'a');
    sm.request('b', true);
    await sm.flush();
    expect(decodeEnvelope(await storage.getItem(SAVE_KEYS.main)).money).toBe(2);
    expect(decodeEnvelope(await storage.getItem(SAVE_KEYS.backup)).money).toBe(1);
  });

  it('a failed write is reported as an error and does not touch the existing save', async () => {
    const storage = new MemoryStorage();
    const onSaved = vi.fn();
    const sm = new SaveManager(storage, () => sampleSave(), onSaved, 10);
    sm.request('first', true);
    await sm.flush();
    const before = await storage.getItem(SAVE_KEYS.main);
    storage.failNextWrite = true;
    sm.request('second', true);
    expect(await sm.flush()).toBe(false);
    expect(onSaved).toHaveBeenLastCalledWith(false, 'second', expect.stringContaining('simulated'));
    expect(await storage.getItem(SAVE_KEYS.main)).toBe(before);
  });

  it('debounces bursts of requests into a single write', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const spy = vi.spyOn(storage, 'setMany');
    const sm = new SaveManager(storage, () => sampleSave(), () => {}, 800);
    sm.request('x');
    sm.request('y');
    sm.request('z');
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(900);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('falls back to the backup when the main save is corrupted', async () => {
    const storage = new MemoryStorage();
    let money = 0;
    const sm = new SaveManager(storage, () => ({ ...sampleSave(), money: (money += 10) }), () => {}, 10);
    sm.request('1', true);
    await sm.flush();
    sm.request('2', true);
    await sm.flush();
    storage.data.set(SAVE_KEYS.main, '{"checksum":"0","payload":"{trunc');
    const r = await sm.load();
    expect(r.source).toBe('backup');
    expect(r.data?.money).toBe(10);
    storage.data.set(SAVE_KEYS.backup, 'garbage');
    expect((await sm.load()).data).toBeNull();
  });

  it('a loaded save restores progress into a fresh Game', async () => {
    const storage = new MemoryStorage();
    const g1 = new Game();
    const sm1 = new SaveManager(storage, () => g1.toSave(), () => {}, 10);
    g1.saveManager = sm1;
    g1.newGame('oren');
    g1.debugGrant(150, 2);
    g1.purchaseSkill('oren', 'combo_basics');
    await sm1.flush();
    const g2 = new Game();
    const r = await new SaveManager(storage, () => g2.toSave(), () => {}, 10).load();
    g2.loadSave(r.data!);
    expect(g2.leaderId).toBe('oren');
    expect(g2.roster.oren.level).toBe(2);
    expect(g2.roster.oren.skills.combo_basics).toBe(1);
    expect(g2.leader().combatant!.unlockedMoves).toContain('launcher');
    expect(g2.fsm.state).toBe('WORLD_EXPLORATION');
  });
});

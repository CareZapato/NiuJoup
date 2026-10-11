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
    expect(d.version).toBe(3);
    expect(d.leader).toBe('suri');
    expect(d.roster.suri.skills).toEqual({ combo_basics: 1, rogafufuken: 1 });
    expect(d.roster.suri.slots[0]).toBe('rogafufuken');
    expect(d.money).toBe(321);
    expect(d.world.openedChests).toEqual(['chest_village']);
    expect(d.world.defeatedPersistent).toEqual(['e_golem']);
  });

  it('migrates a v2 save (old cast) to v3 without losing progress, items or money', () => {
    const v2 = {
      ...sampleSave(),
      version: 2,
      leader: 'toren',
      partyOrder: ['toren', 'kaien', 'oren'],
      money: 777,
      inventory: { herb: 2 },
    } as unknown as Record<string, unknown> & { roster: Record<string, Record<string, unknown>> };
    const roster = v2.roster;
    roster.kaien = { ...roster.kaien, level: 6, xp: 40, ap: 1, skills: { combo_basics: 1, ki_barrage: 1, teleport: 1, meteor_impact: 1 } };
    roster.oren = { ...roster.oren, level: 3, ap: 0, skills: { charged_shot: 1 } };
    roster.toren = { characterId: 'toren', level: 5, xp: 0, ap: 0, skills: {}, equipment: { hands: 'iron_wristbands', body: null, accessory: null }, hp: 10, ki: 10 };
    for (const id of Object.keys(roster)) {
      delete roster[id].slots;
      delete roster[id].limit;
      delete roster[id].rage;
    }
    const d = migrate(v2);
    expect(d.version).toBe(3);
    expect(d.roster.toren).toBeUndefined();
    expect(d.leader).not.toBe('toren');
    expect(d.partyOrder).toEqual(['kaien', 'oren', 'suri']);
    expect(d.inventory.iron_wristbands).toBe(1);
    expect(d.inventory.herb).toBe(2);
    expect(d.money).toBe(777);
    const k = d.roster.kaien;
    expect(k.level).toBe(6);
    expect(k.xp).toBe(40);
    // ki_barrage (2 AP) is refunded; teleport and meteor impact are kept; Kamehameha is granted.
    expect(k.ap).toBe(3);
    expect(k.skills).toMatchObject({ combo_basics: 1, teleport: 1, meteor_impact: 1, kamehameha: 1 });
    expect(k.skills.ki_barrage).toBeUndefined();
    expect(k.slots).toContain('kamehameha');
    expect(k.slots).toContain('teleport');
    expect(k.limit).toBe('ki_volley');
    expect(k.rage).toBe(0);
    expect(d.roster.oren.ap).toBe(2);
    expect(d.roster.oren.skills.kienzan).toBe(1);
    expect(() => validate(d as unknown as Record<string, unknown>)).not.toThrow();
  });

  it('a save never contains transient focus / slow-motion / confusion state', () => {
    const g = new Game();
    g.newGame('kaien');
    const json = JSON.stringify(g.toSave());
    for (const k of ['focus', 'timeScale', 'confused', 'sequenceToken', 'buff', 'blind']) expect(json).not.toContain(`"${k}`);
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

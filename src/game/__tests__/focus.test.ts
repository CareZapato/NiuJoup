import { describe, expect, it } from 'vitest';
import type { Combatant, Entity } from '../components';
import { BALANCE } from '../content/balance';
import { CHARACTERS } from '../content/characters';
import { MOVES, sequencesOf } from '../content/moves';
import { SKILL_TREES, SKILLS } from '../content/skills';
import type { FocusSymbol } from '../content/types';
import { QUESTS } from '../content/items';
import { TICK_DT } from '../core/loop/FixedLoop';
import { Game } from '../Game';
import type { BindAction } from '../settings';
import { chargeKi, penalizeKi, regenKi, spendKi } from '../systems/combat/ki';
import { addRage, rageFromDamage, rageFromHitLanded } from '../systems/combat/rage';
import { distribute, selectTargets } from '../systems/combat/targeting';
import { FocusController, isPrefixFree } from '../systems/focus/FocusController';
import { canPurchaseSkill, createMember, purchaseSkill, unlockedTechniques } from '../systems/progression/progression';

const F = BALANCE.focus;
const REAL = 1 / 60;

function tick(g: Game, n = 1): void {
  for (let i = 0; i < n; i++) g.frame(TICK_DT);
}

function runUntil(g: Game, pred: () => boolean, max: number): void {
  for (let i = 0; i < max; i++) {
    if (pred()) return;
    tick(g);
  }
  throw new Error(`condition not reached in ${max} ticks (state ${g.fsm.state})`);
}

function press(g: Game, ...keys: BindAction[]): void {
  for (const k of keys) g.input.setKey(k, true);
  tick(g);
  for (const k of keys) g.input.setKey(k, false);
}

const engaged = (g: Game): Entity[] => g.world.query('combatant').filter((e) => e.combatant!.engaged);
const enemies = (g: Game): Entity[] => engaged(g).filter((e) => e.combatant!.team === 'enemy');

/** Combat with everyone except the controlled hero frozen, so nothing interferes. */
function readyCombat(leader = 'kaien'): { g: Game; me: Combatant; meE: Entity } {
  const g = new Game();
  g.newGame(leader);
  tick(g);
  expect(g.debugEncounter()).toBe(true);
  runUntil(g, () => g.fsm.state === 'ACTIVE_COMBAT', BALANCE.transition.encounterTicks + 10);
  const meE = g.controlled()!;
  for (const e of engaged(g)) if (e !== meE) e.combatant!.confusedTicks = 1e7;
  const me = meE.combatant!;
  runUntil(g, () => ['IDLE', 'MOVE', 'FLY'].includes(me.state), 200);
  for (const e of engaged(g)) e.combatant!.stats.criticalRate = 0;
  return { g, me, meE };
}

const DIRS: [BindAction, number, number][] = [
  ['stickUp', 0, 1],
  ['stickDown', 0, -1],
  ['stickLeft', -1, 0],
  ['stickRight', 1, 0],
];
const BUTTON: Partial<Record<FocusSymbol, BindAction>> = { P: 'light', K: 'ki', H: 'heavy', G: 'guard' };

/** Enters one focus symbol with the keyboard on the real-time clock. */
function sym(g: Game, s: FocusSymbol): void {
  const key = BUTTON[s] ?? DIRS.find(([, x, y]) => g.focus.symbolFor(x, y) === s)?.[0];
  if (!key) throw new Error(`no key for ${s}`);
  g.input.setKey(key, true);
  g.frame(REAL);
  g.input.setKey(key, false);
  g.frame(REAL);
}

function realFrames(g: Game, n: number): void {
  for (let i = 0; i < n; i++) g.frame(REAL);
}

describe('focus combos: time', () => {
  it('slows the whole world to 0.2 for exactly 3 real seconds, then restores time and the filter', () => {
    const { g, me } = readyCombat();
    press(g, 'focus');
    expect(g.focus.active).toBe(true);
    const t0 = g.loop.tick;
    realFrames(g, 179);
    expect(g.focus.active).toBe(true);
    expect(g.timeScale).toBe(F.timeScale);
    expect(g.focusFilter).toBe(1);
    // 179 real frames at 0.2× ≈ 35.8 simulation ticks.
    expect(g.loop.tick - t0).toBeGreaterThanOrEqual(35);
    expect(g.loop.tick - t0).toBeLessThanOrEqual(36);
    realFrames(g, 1);
    expect(g.focus.active).toBe(false);
    expect(g.timeScale).toBe(1);
    // Confusion starts at the timeout; the same frame may already run a normal-speed tick.
    expect(me.confusedTicks).toBeGreaterThanOrEqual(F.confusedTicks - 1);
    realFrames(g, Math.ceil(F.filterRampSeconds * 60) + 1);
    expect(g.focusFilter).toBe(0);
  });

  it('confusion lasts 1.5 s of simulation time: no attack, guard or dodge, no i-frames', () => {
    const { g, me } = readyCombat();
    press(g, 'focus');
    sym(g, 'H');
    expect(g.focus.active).toBe(false);
    expect(me.confusedTicks).toBeGreaterThanOrEqual(F.confusedTicks - 2);
    expect(me.invuln).toBe(0);
    tick(g);
    expect(me.state).toBe('CONFUSED');
    press(g, 'light');
    expect(me.moveId).toBeNull();
    g.input.setKey('guard', true);
    press(g, 'dash');
    tick(g, 5);
    expect(me.state).toBe('CONFUSED');
    g.input.setKey('guard', false);
    runUntil(g, () => me.confusedTicks === 0, F.confusedTicks);
    tick(g);
    expect(me.state).not.toBe('CONFUSED');
  });

  it('a confused fighter takes ×1.25 damage', () => {
    const { g, meE, me } = readyCombat();
    const foe = enemies(g)[0];
    me.hp = me.stats.maxHp;
    const normal = g.debugHit(foe.id, meE.id, 'heavy');
    me.hp = me.stats.maxHp;
    me.state = 'IDLE';
    me.hitstun = 0;
    me.confusedTicks = 60;
    const confused = g.debugHit(foe.id, meE.id, 'heavy');
    expect(confused / normal).toBeCloseTo(F.confusedDamageTaken, 1);
  });

  it('a hit interrupts focus and restores time and filter (no confusion, cooldown applies)', () => {
    const { g, me, meE } = readyCombat();
    press(g, 'focus');
    realFrames(g, 30);
    expect(g.focusFilter).toBeGreaterThan(0.9);
    g.debugHit(enemies(g)[0].id, meE.id, 'light_1');
    expect(g.focus.active).toBe(false);
    expect(g.timeScale).toBe(1);
    expect(me.confusedTicks).toBe(0);
    realFrames(g, 10);
    expect(g.focusFilter).toBe(0);
    expect(g.getUi().focus.ready).toBe(false);
  });

  it('defeat and pause always restore normal time', () => {
    const a = readyCombat();
    press(a.g, 'focus');
    a.me.hp = 0;
    a.me.state = 'DEFEATED';
    realFrames(a.g, 10);
    expect(a.g.focus.active).toBe(false);
    expect(a.g.timeScale).toBe(1);

    const b = readyCombat();
    press(b.g, 'focus');
    b.g.pause();
    expect(b.g.focus.active).toBe(false);
    b.g.frame(REAL);
    expect(b.g.timeScale).toBe(1);
  });

  it('cooldown of 8 simulation seconds; focus never stacks or restarts', () => {
    const { g, me } = readyCombat();
    press(g, 'focus');
    realFrames(g, 30);
    const elapsed = g.focus.elapsed;
    press(g, 'focus');
    expect(g.focus.elapsed).toBeGreaterThan(elapsed);
    sym(g, 'H');
    runUntil(g, () => me.confusedTicks === 0 && ['IDLE', 'MOVE', 'FLY'].includes(me.state), 200);
    press(g, 'focus');
    expect(g.focus.active).toBe(false);
    tick(g, F.cooldownTicks);
    runUntil(g, () => ['IDLE', 'MOVE', 'FLY'].includes(me.state), 200);
    press(g, 'focus');
    expect(g.focus.active).toBe(true);
  });
});

describe('focus combos: techniques, ki and rage', () => {
  it('Kamehameha: sequence success, ki charged once at execution, name event once', () => {
    const { g, me } = readyCombat();
    me.ki = 100;
    const used: string[] = [];
    g.events.on('techniqueUsed', (e) => used.push(e.moveId));
    press(g, 'focus');
    const seq = MOVES.kamehameha.technique!.sequence!;
    for (const s of seq.slice(0, -1)) sym(g, s);
    expect(g.focus.active).toBe(true);
    expect(me.ki).toBe(100);
    sym(g, seq[seq.length - 1]);
    expect(g.focus.active).toBe(false);
    runUntil(g, () => me.moveId === 'kamehameha', 20);
    expect(me.ki).toBe(100 - BALANCE.ki.costs.kamehameha);
    runUntil(g, () => me.moveId !== 'kamehameha', 200);
    expect(me.ki).toBe(100 - BALANCE.ki.costs.kamehameha);
    expect(used).toEqual(['kamehameha']);
  });

  it('offensive specials cannot skip their sequence: the slot button only preselects', () => {
    const { g, me } = readyCombat();
    me.ki = 100;
    press(g, 'slot1');
    expect(g.focus.active).toBe(true);
    expect(g.focus.candidates.map((c) => c.moveId)).toEqual(['kamehameha']);
    expect(me.moveId).toBeNull();
    // A forged intent without the sequence token is rejected for player fighters.
    g.pause();
    g.resume();
    me.intent.technique = 'kamehameha';
    tick(g);
    expect(me.moveId).not.toBe('kamehameha');
  });

  it('insufficient ki is rejected at sequence start (nothing charged)', () => {
    const { g, me } = readyCombat();
    me.ki = 10;
    press(g, 'slot1');
    expect(g.focus.active).toBe(false);
    expect(me.ki).toBeGreaterThanOrEqual(10);
  });

  it('a failed ability sequence costs a small ki penalty, never below zero', () => {
    const { g, me } = readyCombat();
    me.ki = 40;
    press(g, 'focus');
    sym(g, 'H');
    expect(me.ki).toBe(40 - F.failKiPenalty);
    const c = { ki: 2 };
    penalizeKi(c, 5);
    expect(c.ki).toBe(0);
  });

  it('the limit consumes all rage, costs no ki and its own hits do not refill rage', () => {
    const { g, me } = readyCombat();
    me.ki = 50;
    g.debugSetRage(100);
    // Enemy-side power balance so team dominance cannot add rage during the check.
    g.debugAddPower(-200);
    press(g, 'special');
    expect(g.focus.active).toBe(true);
    for (const s of MOVES.ki_volley.technique!.sequence!) sym(g, s);
    runUntil(g, () => me.moveId === 'ki_volley', 20);
    expect(me.rage).toBe(0);
    expect(me.ki).toBe(50);
    runUntil(g, () => me.moveId !== 'ki_volley', 400);
    expect(me.rage).toBe(0);
  });

  it('a failed limit sequence consumes half the rage and confuses', () => {
    const { g, me } = readyCombat();
    me.ki = 50;
    g.debugSetRage(100);
    press(g, 'special');
    sym(g, 'H');
    expect(me.rage).toBe(100 * (1 - F.failRageFraction));
    expect(me.ki).toBe(50);
    expect(me.confusedTicks).toBeGreaterThanOrEqual(F.confusedTicks - 2);
  });

  it('without full rage the limit cannot start', () => {
    const { g } = readyCombat();
    g.debugSetRage(99);
    press(g, 'special');
    expect(g.focus.active).toBe(false);
  });
});

describe('focus controller', () => {
  const cand = (moveId: string, sequence: FocusSymbol[]) => ({ moveId, name: moveId, sequence, mode: 'spread' as const, limit: false });

  it('the stick must return to neutral to repeat a direction or after start', () => {
    const f = new FocusController();
    f.start(1, [cand('a', ['F', 'F', 'K'])], null, 1, 0);
    expect(f.stick(1, 0)).toBeNull();
    expect(f.input).toEqual([]);
    f.stick(0, 0);
    f.stick(1, 0);
    expect(f.input).toEqual(['F']);
    f.stick(1, 0);
    f.stick(0.9, 0.1);
    expect(f.input).toEqual(['F']);
    f.stick(0.1, 0);
    f.stick(1, 0);
    expect(f.input).toEqual(['F', 'F']);
  });

  it('forward/back are fixed at start relative to the target', () => {
    const f = new FocusController();
    f.start(1, [cand('a', ['F', 'K', 'K'])], null, -1, 0);
    expect(f.symbolFor(-1, 0)).toBe('F');
    expect(f.symbolFor(1, 0)).toBe('B');
  });

  it('every character has prefix-free sequences of 3-5 inputs', () => {
    for (const ch of Object.values(CHARACTERS)) {
      const tree = SKILL_TREES[ch.skillTree];
      const moveIds = new Set<string>(ch.limitMoveId ? [ch.limitMoveId] : []);
      for (const n of tree.nodes) for (const id of SKILLS[n.skillId].unlocksMoves) if (MOVES[id]?.technique) moveIds.add(id);
      const seqs = [...moveIds].flatMap((id) => sequencesOf(MOVES[id]).map((s) => s.sequence));
      expect(isPrefixFree(seqs), ch.id).toBe(true);
      for (const s of seqs) {
        expect(s.length).toBeGreaterThanOrEqual(3);
        expect(s.length).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('ki', () => {
  it('spend is all-or-nothing and never negative; regen is capped; charge is 12/s', () => {
    const c = { ki: 20, stats: { maxKi: 100 } };
    expect(spendKi(c, 30)).toBe(false);
    expect(c.ki).toBe(20);
    expect(spendKi(c, 20)).toBe(true);
    expect(c.ki).toBe(0);
    for (let i = 0; i < 60 * 120; i++) regenKi(c);
    expect(c.ki).toBeCloseTo(100 * BALANCE.ki.regenCapFraction, 5);
    const d = { ki: 0, stats: { maxKi: 100 } };
    for (let i = 0; i < 60; i++) chargeKi(d);
    expect(d.ki).toBeCloseTo(BALANCE.ki.chargePerSecond, 5);
  });

  it('same ki on the map and in the arena: map blast costs 3, no refill entering combat', () => {
    const g = new Game();
    g.newGame('kaien');
    tick(g);
    const lc = g.leader().combatant!;
    lc.ki = 50;
    press(g, 'ki');
    expect(lc.ki).toBe(50 - BALANCE.ki.costs.kiBlast);
    g.debugEncounter();
    runUntil(g, () => g.fsm.state === 'ACTIVE_COMBAT', BALANCE.transition.encounterTicks + 10);
    expect(g.leader().combatant!.ki).toBe(50 - BALANCE.ki.costs.kiBlast);
  });

  it('manual charge in combat: immobile, blocks attacks, interrupted by a hit', () => {
    const { g, me, meE } = readyCombat();
    me.ki = 20;
    g.input.setKey('charge', true);
    tick(g);
    expect(me.state).toBe('CHARGE');
    const p = { ...meE.transform.pos };
    g.input.setKey('stickRight', true);
    press(g, 'light');
    tick(g, 58);
    expect(me.state).toBe('CHARGE');
    expect(me.moveId).toBeNull();
    expect(Math.hypot(meE.transform.pos.x - p.x, meE.transform.pos.z - p.z)).toBeLessThan(0.3);
    expect(me.ki).toBeGreaterThan(20 + BALANCE.ki.chargePerSecond * 0.9);
    expect(me.ki).toBeLessThan(20 + BALANCE.ki.chargePerSecond * 1.1);
    g.debugHit(enemies(g)[0].id, meE.id, 'light_1');
    expect(me.state).not.toBe('CHARGE');
    g.input.setKey('charge', false);
    g.input.setKey('stickRight', false);
  });

  it('victory does not refill ki', () => {
    const { g, me } = readyCombat();
    me.ki = 40;
    for (const e of enemies(g)) e.combatant!.hp = 0;
    for (const e of enemies(g)) e.combatant!.state = 'DEFEATED';
    runUntil(g, () => g.fsm.state === 'WORLD_EXPLORATION', 1200);
    expect(g.roster.kaien.ki).toBeLessThanOrEqual(40.01);
  });
});

describe('rage', () => {
  const fighter = (team: 'player' | 'enemy', engagedFlag = true) => ({ team, engaged: engagedFlag, rage: 0, state: 'IDLE', stats: { maxHp: 200 } }) as unknown as Combatant;

  it('comes mainly from enemy damage, less from landing hits, never from self/allies/outside combat', () => {
    const hero = fighter('player');
    const foe = fighter('enemy');
    rageFromDamage(hero, foe, 20, false);
    const fromDamage = hero.rage;
    expect(fromDamage).toBeGreaterThan(0);
    hero.rage = 0;
    rageFromHitLanded(hero, foe);
    expect(hero.rage).toBeLessThan(fromDamage);

    const solo = fighter('player');
    rageFromDamage(solo, solo, 50, false);
    rageFromDamage(solo, fighter('player'), 50, false);
    expect(solo.rage).toBe(0);
    const outside = fighter('player', false);
    rageFromDamage(outside, fighter('enemy', false), 50, false);
    expect(outside.rage).toBe(0);
    expect(addRage(foe, 50)).toBe(false);
    expect(foe.rage).toBe(0);
  });

  it('Kaioken strain never feeds rage and never kills', () => {
    const g = new Game();
    g.newGame('kaien');
    g.debugGrant(5000, 10);
    expect(g.purchaseSkill('kaien', 'kaioken')).toBeNull();
    expect(g.roster.kaien.slots).toContain('kaioken');
    tick(g);
    g.debugEncounter();
    runUntil(g, () => g.fsm.state === 'ACTIVE_COMBAT', BALANCE.transition.encounterTicks + 10);
    const meE = g.controlled()!;
    const me = meE.combatant!;
    for (const e of engaged(g)) if (e !== meE) e.combatant!.confusedTicks = 1e7;
    runUntil(g, () => ['IDLE', 'MOVE', 'FLY'].includes(me.state), 200);
    me.ki = 100;
    me.hp = 3;
    me.rage = 0;
    const slot = g.roster.kaien.slots.indexOf('kaioken');
    press(g, (['slot1', 'slot2', 'slot3', 'slot4'] as const)[slot]);
    runUntil(g, () => me.buff !== null, 60);
    tick(g, 300);
    expect(me.hp).toBeGreaterThanOrEqual(1);
    expect(me.rage).toBe(0);
  });

  it('persists between arena and map', () => {
    const { g } = readyCombat();
    g.debugSetRage(42);
    for (const e of enemies(g)) e.combatant!.hp = 0;
    for (const e of enemies(g)) e.combatant!.state = 'DEFEATED';
    runUntil(g, () => g.fsm.state === 'WORLD_EXPLORATION', 1200);
    expect(Math.floor(g.leader().combatant!.rage)).toBe(42);
    expect(Math.floor(g.toSave()!.roster.kaien.rage)).toBe(42);
  });
});

describe('multi-target', () => {
  it('selection only returns hostile fighters, capped by maxTargets; no friendly fire', () => {
    const { g, meE } = readyCombat();
    const all = g.world.query('combatant');
    for (const id of ['kakusandan', 'taiyoken', 'kamehameha', 'sokidan']) {
      const t = MOVES[id].technique!.targeting;
      const picked = selectTargets(meE, all, { origin: meE.transform.pos, dirX: 1, dirZ: 0, targeting: { ...t, requireLineOfSight: false, range: 999, width: 999 }, preferId: -1 }, g.map.tiles);
      expect(picked.every((e) => e.combatant!.team === 'enemy'), id).toBe(true);
      expect(picked.length).toBeLessThanOrEqual(t.maxTargets);
    }
    const ally = g.heroes().find((h) => h !== meE)!;
    const hp = ally.combatant!.hp;
    expect(g.debugHit(meE.id, ally.id, 'heavy')).toBe(0);
    expect(ally.combatant!.hp).toBe(hp);
    const npc = g.world.entities.find((e) => e.kind === 'npc');
    if (npc) expect(g.debugHit(meE.id, npc.id, 'heavy')).toBe(0);
  });

  it('spread vs concentrate distribution', () => {
    const a = { id: 1 } as Entity;
    const b = { id: 2 } as Entity;
    expect(distribute([a, b], 4, 'spread').map((e) => e?.id)).toEqual([1, 2, 1, 2]);
    expect(distribute([a, b], 3, 'concentrate').map((e) => e?.id)).toEqual([1, 1, 1]);
    expect(distribute([], 2, 'spread')).toEqual([null, null]);
  });
});

describe('stun-lock breaker', () => {
  it('a continuously juggled fighter gets a short armor window (damage yes, stun no)', () => {
    const { g, meE } = readyCombat();
    const foe = enemies(g)[0]!;
    const fc = foe.combatant!;
    fc.confusedTicks = 0;
    fc.hp = fc.stats.maxHp = 1e6;
    let armoredAt = -1;
    for (let t = 0; t < 400 && armoredAt < 0; t++) {
      if (t % 8 === 0) g.debugHit(meE.id, foe.id, 'light_1');
      tick(g);
      if (fc.stunArmorTicks > 0) armoredAt = t;
    }
    expect(armoredAt).toBeGreaterThan(BALANCE.combat.stunLockMaxTicks - 10);
    expect(armoredAt).toBeLessThan(BALANCE.combat.stunLockMaxTicks * 2);
    const hp = fc.hp;
    const lost = g.debugHit(meE.id, foe.id, 'light_1');
    expect(lost).toBeGreaterThan(0);
    expect(fc.hp).toBeLessThan(hp);
    for (let t = 0; t < 12; t++) {
      if (t % 4 === 0) g.debugHit(meE.id, foe.id, 'light_1');
      tick(g);
    }
    expect(fc.state).not.toBe('HIT_STUN');
  });
});

describe('progression', () => {
  it('mandatory techniques are always obtainable (no exclusive branches)', () => {
    const quests = Object.keys(QUESTS);
    for (const ch of Object.values(CHARACTERS)) {
      const m = createMember(ch.id);
      m.level = 20;
      m.ap = 999;
      let bought = true;
      while (bought) {
        bought = false;
        for (const n of SKILL_TREES[ch.skillTree].nodes) {
          if (canPurchaseSkill(m, n.skillId, quests).ok) {
            purchaseSkill(m, n.skillId, quests);
            bought = true;
          }
        }
      }
      for (const t of ch.mandatoryTechniques) expect(unlockedTechniques(m), `${ch.id}:${t}`).toContain(t);
      expect(m.slots.length).toBe(4);
    }
  });

  it('display names are exactly Goku, Krillin and Yamcha', () => {
    expect(Object.values(CHARACTERS).map((c) => c.name).sort()).toEqual(['Goku', 'Krillin', 'Yamcha']);
  });

  it('slots are reassigned only outside combat, swap on duplicates and persist in the save', () => {
    const g = new Game();
    g.newGame('kaien');
    tick(g);
    const known = g.techniquesOf('oren').map((t) => t.id);
    expect(known.length).toBeGreaterThan(0);
    const first = known[0]!;
    expect(g.techniquesOf('oren')[0]!.status).toMatch(/canónica|Adaptación/);
    expect(g.setSlot('oren', 3, first)).toBe(true);
    expect(g.roster.oren.slots[3]).toBe(first);
    expect(g.roster.oren.slots.filter((s) => s === first).length).toBe(1);
    expect(g.setSlot('oren', 0, 'kamehameha')).toBe(known.includes('kamehameha'));
    expect(g.setSlot('oren', 2, null)).toBe(true);
    expect(g.roster.oren.slots[2]).toBeNull();
    expect(g.toSave()?.roster.oren.slots).toEqual(g.roster.oren.slots);
    expect(g.debugEncounter()).toBe(true);
    expect(g.setSlot('oren', 1, first)).toBe(false);
  });
});

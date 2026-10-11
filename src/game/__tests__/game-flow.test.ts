import { describe, expect, it } from 'vitest';
import type { BindAction } from '../settings';
import { BALANCE } from '../content/balance';
import { TICK_DT } from '../core/loop/FixedLoop';
import { Game } from '../Game';

function tick(g: Game, n = 1): void {
  for (let i = 0; i < n; i++) g.frame(TICK_DT);
}

function runUntil(g: Game, pred: () => boolean, max: number): number {
  for (let i = 0; i < max; i++) {
    if (pred()) return i;
    tick(g);
  }
  throw new Error(`condition not reached in ${max} ticks (state ${g.fsm.state})`);
}

function press(g: Game, ...keys: BindAction[]): void {
  for (const k of keys) g.input.setKey(k, true);
  tick(g);
  for (const k of keys) g.input.setKey(k, false);
}

function newGame(leader = 'kaien'): Game {
  const g = new Game();
  g.newGame(leader);
  tick(g);
  return g;
}

function enterCombat(g: Game): void {
  expect(g.debugEncounter()).toBe(true);
  runUntil(g, () => g.fsm.state === 'ACTIVE_COMBAT', BALANCE.transition.encounterTicks + 10);
}

const enemies = (g: Game) => g.world.query('combatant').filter((e) => e.combatant!.engaged && e.combatant!.team === 'enemy');

describe('world exploration', () => {
  it('keyboard input moves the leader and the party follows', () => {
    const g = newGame();
    const p0 = { ...g.leader().transform.pos };
    g.input.setKey('stickRight', true);
    tick(g, 40);
    g.input.setKey('stickRight', false);
    const p1 = g.leader().transform.pos;
    expect(p1.x - p0.x).toBeGreaterThan(1.5);
    tick(g, 60);
    const follower = g.heroes().find((h) => h !== g.leader())!;
    expect(Math.hypot(follower.transform.pos.x - p1.x, follower.transform.pos.z - p1.z)).toBeLessThan(4);
  });

  it('a visible enemy detects the player (distance + line of sight) and contact starts the encounter', () => {
    const g = newGame();
    const enemy = g.world.getStable('e_sprout_1')!;
    const l = g.leader();
    l.transform.pos.x = enemy.transform.pos.x - 3;
    l.transform.pos.z = enemy.transform.pos.z;
    runUntil(g, () => enemy.explorer!.state === 'ALERT' || enemy.explorer!.state === 'CHASE', 30);
    runUntil(g, () => g.fsm.state === 'ENCOUNTER_TRANSITION', 400);
    expect(g.camera.mode).toBe('EncounterCamera');
  });
});

describe('seamless world -> combat transition', () => {
  it('blends the camera, engages fighters and hands control back quickly', () => {
    const g = newGame();
    expect(g.debugEncounter()).toBe(true);
    expect(g.fsm.state).toBe('ENCOUNTER_TRANSITION');
    const engaged = g.world.query('combatant').filter((e) => e.combatant!.engaged);
    expect(engaged.filter((e) => e.combatant!.team === 'player')).toHaveLength(3);
    expect(engaged.every((e) => e.body!.flying)).toBe(true);
    expect(g.leader().combatant!.playerControlled).toBe(true);
    const ticks = runUntil(g, () => g.fsm.state === 'ACTIVE_COMBAT', 120);
    expect(ticks).toBeLessThanOrEqual(BALANCE.transition.encounterTicks + 2);
    expect(g.camera.mode).toBe('CombatCamera');
    expect(g.camera.pose.pitch).toBeLessThan(0.6);
  });

  it('allies act during the transition before the player regains control', () => {
    const g = newGame();
    g.debugEncounter();
    tick(g, 20);
    const allies = g.heroes().filter((h) => !h.combatant!.playerControlled);
    expect(allies.some((a) => a.combatant!.intent.moveX !== 0 || a.combatant!.intent.moveZ !== 0 || a.combatant!.intent.action !== null || a.combatant!.state !== 'IDLE')).toBe(true);
  });
});

describe('combat', () => {
  it('J starts a light attack through the same intent path the AI uses', () => {
    const g = newGame();
    enterCombat(g);
    const me = g.controlled()!.combatant!;
    runUntil(g, () => me.state === 'IDLE' || me.state === 'FLY' || me.state === 'MOVE', 120);
    press(g, 'light');
    expect(me.moveId).toBe('light_1');
    expect(me.state).toBe('LIGHT_ATTACK');
  });

  it('locked moves cannot be executed; unlocking the skill enables them', () => {
    const g = newGame();
    enterCombat(g);
    const me = g.controlled()!.combatant!;
    runUntil(g, () => me.state === 'IDLE' || me.state === 'FLY' || me.state === 'MOVE', 120);
    press(g, 'light', 'heavy');
    expect(me.moveId).not.toBe('launcher');

    const g2 = new Game();
    g2.newGame('kaien');
    g2.debugGrant(0, 1);
    expect(g2.purchaseSkill('kaien', 'combo_basics')).toBeNull();
    tick(g2);
    enterCombat(g2);
    const me2 = g2.controlled()!.combatant!;
    runUntil(g2, () => me2.state === 'IDLE' || me2.state === 'FLY' || me2.state === 'MOVE', 120);
    press(g2, 'light', 'heavy');
    expect(me2.moveId).toBe('launcher');
  });

  it('enemy AI engages: it moves toward or attacks the party', () => {
    const g = newGame();
    enterCombat(g);
    const seen = new Set<string>();
    for (let i = 0; i < 240; i++) {
      tick(g);
      for (const e of enemies(g)) seen.add(e.combatant!.state);
    }
    expect([...seen].some((s) => ['LIGHT_ATTACK', 'HEAVY_ATTACK', 'KI_ATTACK', 'GUARD', 'DASH', 'MOVE', 'FLY'].includes(s))).toBe(true);
  });

  it('victory grants XP/AP, removes the enemy and returns to the world with an autosave request', () => {
    const g = newGame();
    const before = { xp: g.roster.kaien.xp, ap: g.roster.kaien.ap };
    enterCombat(g);
    for (const e of enemies(g)) e.combatant!.hp = 1;
    runUntil(g, () => g.fsm.state === 'COMBAT_VICTORY' || g.fsm.state === 'RETURN_TO_WORLD', 1800);
    expect(g.roster.kaien.level > 1 || g.roster.kaien.xp > before.xp).toBe(true);
    expect(g.roster.kaien.ap).toBeGreaterThan(before.ap);
    runUntil(g, () => g.fsm.state === 'WORLD_EXPLORATION', 600);
    expect(g.camera.mode).toBe('ExplorationCamera');
    expect(enemies(g)).toHaveLength(0);
    expect(Object.keys(g.worldState.enemyRespawnAt).length).toBeGreaterThan(0);
  });

  it('defeat returns the party to the last checkpoint with HP restored', () => {
    const g = newGame();
    enterCombat(g);
    for (const h of g.heroes()) {
      h.combatant!.hp = 0;
      h.combatant!.state = 'DEFEATED';
    }
    runUntil(g, () => g.fsm.state === 'COMBAT_DEFEAT', 10);
    runUntil(g, () => g.fsm.state === 'WORLD_EXPLORATION', 800);
    const p = g.leader().transform.pos;
    expect(Math.hypot(p.x - g.checkpoint.x, p.z - g.checkpoint.z)).toBeLessThan(2);
    expect(g.leader().combatant!.hp).toBeGreaterThan(0);
  });

  it('pausing freezes the simulation and resumes the same combat state', () => {
    const g = newGame();
    enterCombat(g);
    press(g, 'menu');
    expect(g.fsm.state).toBe('PAUSED');
    const snapshot = g.world.query('combatant').map((e) => ({ ...e.transform.pos }));
    tick(g, 60);
    expect(g.world.query('combatant').map((e) => ({ ...e.transform.pos }))).toEqual(snapshot);
    tick(g, 2);
    press(g, 'menu');
    expect(g.fsm.state).toBe('ACTIVE_COMBAT');
  });

  it('dominance enables the Meteo Attack for the player team', () => {
    const g = newGame();
    enterCombat(g);
    g.debugAddPower(100);
    expect(g.pb.dominance).toBe('player');
    const me = g.controlled()!.combatant!;
    runUntil(g, () => me.state === 'IDLE' || me.state === 'FLY' || me.state === 'MOVE', 120);
    const victims = enemies(g);
    press(g, 'special');
    expect(me.meteo).not.toBeNull();
    expect(g.pb.dominance).toBeNull();
    const hpBefore = victims.reduce((a, e) => a + e.combatant!.hp, 0);
    runUntil(g, () => me.meteo === null, 200);
    expect(victims.reduce((a, e) => a + e.combatant!.hp, 0)).toBeLessThan(hpBefore);
  });
});

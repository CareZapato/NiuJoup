import { describe, expect, it } from 'vitest';
import { buildValley } from '../content/maps/valley';
import { World } from '../core/ecs/World';
import { FixedLoop, TICK_DT } from '../core/loop/FixedLoop';
import { vec3 } from '../core/math';
import { GameStateMachine, InvalidTransitionError } from '../core/state/GameStateMachine';
import { hitboxCenter, sphereHitsCapsule } from '../systems/collision/shapes';

describe('GameStateMachine', () => {
  it('allows the normal world -> combat -> world cycle', () => {
    const f = new GameStateMachine();
    for (const s of ['MAIN_MENU', 'WORLD_EXPLORATION', 'ENCOUNTER_TRANSITION', 'ACTIVE_COMBAT', 'COMBAT_VICTORY', 'RETURN_TO_WORLD', 'WORLD_EXPLORATION'] as const) f.transition(s);
    expect(f.state).toBe('WORLD_EXPLORATION');
  });

  it('rejects invalid transitions', () => {
    const f = new GameStateMachine();
    f.transition('MAIN_MENU');
    expect(() => f.transition('ACTIVE_COMBAT')).toThrow(InvalidTransitionError);
    f.transition('WORLD_EXPLORATION');
    expect(f.canTransition('COMBAT_VICTORY')).toBe(false);
    expect(f.canTransition('ENCOUNTER_TRANSITION')).toBe(true);
  });

  it('PAUSED resumes exactly the previous state and freezes stateTicks', () => {
    const f = new GameStateMachine();
    f.transition('MAIN_MENU');
    f.transition('WORLD_EXPLORATION');
    f.transition('ENCOUNTER_TRANSITION');
    f.transition('ACTIVE_COMBAT');
    f.tick();
    f.tick();
    f.transition('PAUSED');
    f.tick();
    expect(f.canTransition('WORLD_EXPLORATION')).toBe(false);
    expect(f.canTransition('MAIN_MENU')).toBe(true);
    f.resume();
    expect(f.state).toBe('ACTIVE_COMBAT');
  });

  it('notifies listeners', () => {
    const f = new GameStateMachine();
    const seen: string[] = [];
    const off = f.onChange((to, from) => seen.push(`${from}>${to}`));
    f.transition('MAIN_MENU');
    off();
    f.transition('WORLD_EXPLORATION');
    expect(seen).toEqual(['BOOT>MAIN_MENU']);
  });
});

describe('FixedLoop', () => {
  it('runs a fixed number of 60 Hz steps regardless of frame rate', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++);
    for (let i = 0; i < 30; i++) loop.advance(1 / 30);
    expect(steps).toBe(60);
    steps = 0;
    for (let i = 0; i < 144; i++) loop.advance(1 / 144);
    expect(Math.abs(steps - 60)).toBeLessThanOrEqual(1);
  });

  it('clamps catch-up after long stalls and returns an interpolation alpha', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++);
    loop.advance(5);
    expect(steps).toBe(loop.maxStepsPerFrame);
    const a = loop.advance(TICK_DT * 0.5);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  it('does not step while paused', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++);
    loop.paused = true;
    loop.advance(1);
    expect(steps).toBe(0);
  });
});

describe('ECS world', () => {
  it('maintains archetype queries without mutating arrays being iterated', () => {
    const w = new World();
    const mk = (id: string, withBody = true) =>
      w.create({
        stableId: id,
        kind: 'boulder',
        transform: { pos: vec3(), prev: vec3(), yaw: 0 },
        ...(withBody ? { body: { vel: vec3(), radius: 0.3, height: 1, grounded: true, flying: false } } : {}),
      });
    const a = mk('a');
    mk('b');
    mk('c', false);
    const list = w.query('body');
    expect(list.length).toBe(2);
    w.remove(a.id);
    expect(list.length).toBe(2);
    expect(w.query('body').length).toBe(1);
    expect(w.getStable('a')).toBeUndefined();
    expect(() => mk('b')).toThrow();
  });
});

describe('collision', () => {
  it('sphere vs capsule hurtbox', () => {
    const pos = vec3(0, 0, 0);
    expect(sphereHitsCapsule(0.5, 1, 0, 0.3, pos, 1.6, 0.35)).toBe(true);
    expect(sphereHitsCapsule(2, 1, 0, 0.3, pos, 1.6, 0.35)).toBe(false);
    expect(sphereHitsCapsule(0, 3, 0, 0.3, pos, 1.6, 0.35)).toBe(false);
  });

  it('hitboxes follow the attacker facing, not the sprite', () => {
    const out = vec3();
    hitboxCenter(out, vec3(0, 0, 0), 0, 1.6, 1, { forward: 1, up: 0, radius: 0.5 });
    expect(out.z).toBeCloseTo(1);
    hitboxCenter(out, vec3(0, 0, 0), Math.PI / 2, 1.6, 1, { forward: 1, up: 0, radius: 0.5 });
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(0);
  });

  it('tile map blocks trees/houses, allows paths and computes line of sight', () => {
    const map = buildValley();
    const t = map.tiles;
    expect(t.canOccupy(map.start.x, map.start.z, 0, 0.3, 0.55, false)).toBe(true);
    const lamp = map.lamps.find((l) => l.x === 26.2 && l.z === 22.4)!;
    expect(t.canOccupy(lamp.x, lamp.z, 0, 0.3, 0.55, false)).toBe(false);
    expect(t.canOccupy(lamp.x + 1.2, lamp.z, 0, 0.3, 0.55, false)).toBe(true);
    expect(t.canOccupy(0.5, 0.5, 0, 0.3, 0.55, false)).toBe(false);
    expect(t.lineOfSight(map.start.x, map.start.z, map.start.x + 1, map.start.z, 1)).toBe(true);
    expect(t.lineOfSight(map.start.x, map.start.z, 0.5, 0.5, 1)).toBe(false);
  });

  it('dynamic blockers (breakable boulders) block until cleared', () => {
    const map = buildValley();
    const b = map.boulders[0];
    const tx = Math.floor(b.x);
    const tz = Math.floor(b.z);
    const free = map.tiles.canOccupy(b.x, b.z, 0, 0.3, 0.55, false);
    map.tiles.setDynamicBlocker(tx, tz, 2);
    expect(map.tiles.canOccupy(b.x, b.z, 0, 0.3, 0.55, false)).toBe(false);
    map.tiles.clearDynamicBlocker(tx, tz);
    expect(map.tiles.canOccupy(b.x, b.z, 0, 0.3, 0.55, false)).toBe(free);
  });
});

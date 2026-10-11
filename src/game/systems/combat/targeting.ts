import type { Entity } from '../../components';
import type { TargetingDef } from '../../content/types';
import { distXZ, type Vec3 } from '../../core/math';
import type { TileMap } from '../../world/TileMap';

export const isAlive = (e: Entity): boolean => !!e.combatant && e.combatant.engaged && e.combatant.state !== 'DEFEATED';

/**
 * The single source of truth for who may be harmed: a living, engaged
 * combatant of another team. Allies, the caster itself, NPCs, props and
 * anything outside the encounter are never valid.
 */
export function isHostile(self: Entity, other: Entity | undefined): other is Entity {
  if (!other || other === self || !self.combatant || !other.combatant) return false;
  if (other.kind !== 'hero' && other.kind !== 'enemy') return false;
  return isAlive(other) && other.combatant.team !== self.combatant.team;
}

/** Kept for existing call sites; identical to isHostile. */
export const isValidTarget = isHostile;

/** World (exploration) variant: roaming enemies that technique utilities may affect (never damage). */
export function isWorldHostile(e: Entity): boolean {
  return e.kind === 'enemy' && !!e.explorer && e.explorer.state !== 'DEFEATED' && e.explorer.state !== 'IN_COMBAT';
}

export function nearestEnemy(self: Entity, all: readonly Entity[]): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const o of all) {
    if (!isHostile(self, o)) continue;
    const d = distXZ(self.transform.pos, o.transform.pos) + Math.abs(self.transform.pos.y - o.transform.pos.y) * 0.5;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/** Cycles to the next valid enemy ordered by entity id (stable, predictable for the player). */
export function cycleTarget(self: Entity, all: readonly Entity[]): Entity | null {
  const candidates = all.filter((o) => isHostile(self, o)).sort((a, b) => a.id - b.id);
  if (candidates.length === 0) return null;
  const idx = candidates.findIndex((c) => c.id === self.combatant!.targetId);
  return candidates[(idx + 1) % candidates.length];
}

/** How many allies of `self` are currently targeting `target` (used by AI to spread pressure). */
export function attackersOn(target: Entity, self: Entity, all: readonly Entity[]): number {
  let n = 0;
  for (const o of all) {
    if (o === self || !isAlive(o) || o.combatant!.team !== self.combatant!.team) continue;
    if (o.combatant!.targetId === target.id) n++;
  }
  return n;
}

export interface TargetQuery {
  origin: Vec3;
  /** Unit XZ direction for line shapes. */
  dirX: number;
  dirZ: number;
  targeting: TargetingDef;
  /** Preferred target (current lock-on); kept first when valid. */
  preferId: number;
  /** Beam/disc length after terrain clipping (line shapes). */
  length?: number;
}

const chest = (e: Entity): number => e.transform.pos.y + (e.body?.height ?? 1.4) * 0.55;

/**
 * Picks the hostile entities a technique affects, honouring range, area,
 * line of sight and max targets. Pure: no side effects, deterministic order.
 */
export function selectTargets(self: Entity, candidates: readonly Entity[], q: TargetQuery, map: TileMap): Entity[] {
  const t = q.targeting;
  const o = q.origin;
  const los = (e: Entity): boolean => !t.requireLineOfSight || map.lineOfSight(o.x, o.z, e.transform.pos.x, e.transform.pos.z, Math.max(o.y, chest(e)) + 0.2);
  const hostile = candidates.filter((e) => isHostile(self, e));
  const prefer = hostile.find((e) => e.id === q.preferId);
  const byDist = (a: Entity, b: Entity): number => distXZ(a.transform.pos, o) - distXZ(b.transform.pos, o) || a.id - b.id;
  let picked: Entity[];
  switch (t.shape) {
    case 'self':
      return [];
    case 'line': {
      const len = q.length ?? t.range;
      const hits: { e: Entity; along: number }[] = [];
      for (const e of hostile) {
        const rx = e.transform.pos.x - o.x;
        const rz = e.transform.pos.z - o.z;
        const along = rx * q.dirX + rz * q.dirZ;
        if (along < -0.3 || along > len) continue;
        const lat = Math.abs(rx * -q.dirZ + rz * q.dirX);
        const dy = Math.abs(chest(e) - o.y);
        if (lat > t.width + (e.body?.radius ?? 0.3) || dy > t.width + (e.body?.height ?? 1.4) * 0.6) continue;
        hits.push({ e, along });
      }
      hits.sort((a, b) => a.along - b.along || a.e.id - b.e.id);
      picked = hits.map((h) => h.e);
      break;
    }
    case 'circle':
      picked = hostile.filter((e) => distXZ(e.transform.pos, o) <= t.width && los(e)).sort(byDist);
      break;
    case 'single':
    case 'guided': {
      const inRange = hostile.filter((e) => distXZ(e.transform.pos, o) <= t.range && los(e)).sort(byDist);
      picked = prefer && inRange.includes(prefer) ? [prefer, ...inRange.filter((e) => e !== prefer)] : inRange;
      break;
    }
    case 'spread': {
      const inRange = hostile.filter((e) => distXZ(e.transform.pos, o) <= t.range && los(e)).sort(byDist);
      picked = prefer && inRange.includes(prefer) ? [prefer, ...inRange.filter((e) => e !== prefer)] : inRange;
      break;
    }
  }
  return picked.slice(0, Math.max(0, t.maxTargets));
}

/** Distributes `count` emissions over targets round-robin (spread) or all on the first (concentrate). */
export function distribute(targets: readonly Entity[], count: number, mode: 'spread' | 'concentrate'): (Entity | null)[] {
  const out: (Entity | null)[] = [];
  for (let i = 0; i < count; i++) out.push(targets.length === 0 ? null : mode === 'concentrate' ? targets[0] : targets[i % targets.length]);
  return out;
}

/** Marches a straight beam until terrain taller than the beam blocks it. */
export function clipLine(map: TileMap, ox: number, oz: number, y: number, dirX: number, dirZ: number, range: number): number {
  const step = 0.25;
  for (let d = step; d <= range; d += step) {
    if (map.heightAt(ox + dirX * d, oz + dirZ * d) > y) return Math.max(0, d - step);
  }
  return range;
}

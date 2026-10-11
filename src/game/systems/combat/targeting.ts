import type { Entity } from '../../components';
import { distXZ } from '../../core/math';

export const isAlive = (e: Entity): boolean => !!e.combatant && e.combatant.engaged && e.combatant.state !== 'DEFEATED';

export function isValidTarget(self: Entity, other: Entity | undefined): other is Entity {
  return !!other && other !== self && isAlive(other) && other.combatant!.team !== self.combatant!.team;
}

export function nearestEnemy(self: Entity, all: readonly Entity[]): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const o of all) {
    if (!isValidTarget(self, o)) continue;
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
  const candidates = all.filter((o) => isValidTarget(self, o)).sort((a, b) => a.id - b.id);
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

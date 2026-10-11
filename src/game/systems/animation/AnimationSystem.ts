import type { AnimId, Entity } from '../../components';

/**
 * Derives the visual animation from simulation state. Gameplay never reads
 * animations; hit detection uses frame data, so visuals can change freely.
 */
export function animFor(e: Entity, inCombat: boolean, victory: boolean): AnimId {
  const c = e.combatant;
  const body = e.body;
  if (c && inCombat && c.engaged) {
    if (victory && c.state !== 'DEFEATED' && c.team === 'player') return 'victory';
    switch (c.state) {
      case 'DEFEATED':
        return 'defeat';
      case 'DASH':
        return 'dash';
      case 'LIGHT_ATTACK':
        return c.moveId === 'light_2' ? 'kick' : 'punch';
      case 'HEAVY_ATTACK':
        return c.moveId === 'rush' || c.moveId === 'air_chase' ? 'dash' : 'kick';
      case 'KI_ATTACK':
        return 'kiblast';
      case 'SPECIAL_ATTACK':
        return c.meteo && c.meteo.tick > 18 && c.meteo.tick < 82 ? ((c.meteo.tick >> 3) % 2 ? 'kick' : 'punch') : 'special';
      case 'CHARGE':
        return 'charge';
      case 'GUARD':
      case 'PARRY':
        return 'guard';
      case 'HIT_STUN':
        return 'hit';
      case 'KNOCKBACK':
      case 'LAUNCHED':
        return 'knockback';
      case 'MOVE':
      case 'FLY': {
        const sp = body ? Math.hypot(body.vel.x, body.vel.z) : 0;
        return sp > 2.5 ? 'fly' : 'hover';
      }
      default:
        return body && body.flying ? 'hover' : 'idle';
    }
  }
  if (!body) return 'idle';
  if (!body.grounded && body.vel.y > -20 && Math.abs(body.vel.y) > 0.5) return 'jump';
  const sp = Math.hypot(body.vel.x, body.vel.z);
  if (sp > 5.2) return 'run';
  if (sp > 0.4) return 'walk';
  return 'idle';
}

export function updateAnimations(list: readonly Entity[], inCombat: boolean, victory: boolean): void {
  for (const e of list) {
    const s = e.sprite!;
    const next = animFor(e, inCombat, victory);
    if (next !== s.anim) {
      s.anim = next;
      s.animTicks = 0;
    } else s.animTicks++;
    if (s.flashTicks > 0) s.flashTicks--;
    s.aura = !!e.combatant && e.combatant.engaged && (e.combatant.state === 'CHARGE' || e.combatant.transformed || !!e.combatant.meteo);
  }
}

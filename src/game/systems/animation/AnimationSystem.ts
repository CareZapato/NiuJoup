import type { AnimId, Entity } from '../../components';
import { MOVES } from '../../content/moves';
import type { TechniquePose } from '../../content/types';

export const POSE_ANIM: Record<TechniquePose, AnimId> = {
  kamehameha: 'tech_kamehameha',
  kienzan: 'tech_kienzan',
  taiyoken: 'tech_taiyoken',
  sokidan: 'tech_sokidan',
  wolf_fang: 'tech_wolf_fang',
  kaioken: 'tech_kaioken',
  teleport: 'tech_teleport',
  barrage: 'tech_barrage',
  scatter: 'tech_barrage',
};

/** Exploration idle lasting this long switches to the waiting idle. */
const IDLE_WAIT_TICKS = 240;

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
        return body && !body.grounded ? 'fall' : 'defeat';
      case 'DASH': {
        const facing = Math.sin(e.transform.yaw) * c.dashDir.x + Math.cos(e.transform.yaw) * c.dashDir.z;
        return facing < 0.5 ? 'dodge' : 'dash';
      }
      case 'LIGHT_ATTACK':
        return c.moveId === 'light_2' ? 'kick' : 'punch';
      case 'HEAVY_ATTACK':
        return c.moveId === 'rush' || c.moveId === 'air_chase' ? 'dash' : 'kick';
      case 'KI_ATTACK':
        return 'kiblast';
      case 'SPECIAL_ATTACK': {
        if (c.meteo) return c.meteo.tick > 18 && c.meteo.tick < 82 ? ((c.meteo.tick >> 3) % 2 ? 'kick' : 'punch') : 'special';
        const pose = c.moveId ? MOVES[c.moveId]?.technique?.pose : undefined;
        return pose ? POSE_ANIM[pose] : 'special';
      }
      case 'CHARGE':
        return 'charge';
      case 'GUARD':
      case 'PARRY':
        return 'guard';
      case 'CONFUSED':
      case 'BLINDED':
        return 'confused';
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
        return body && body.flying ? 'stance' : 'idle';
    }
  }
  if (c && c.state === 'CHARGE') return 'charge';
  if (!body) return 'idle';
  if (!body.grounded && body.vel.y > -20 && Math.abs(body.vel.y) > 0.5) return 'jump';
  const sp = Math.hypot(body.vel.x, body.vel.z);
  if (sp > 5.2) return 'run';
  if (sp > 0.4) return 'walk';
  return 'idle';
}

/** Prep → release → recovery, from frame data. Multi-hit techniques alternate during the active window. */
export function techniquePhase(c: NonNullable<Entity['combatant']>): number | null {
  if (c.state !== 'SPECIAL_ATTACK' || c.meteo || !c.moveId) return null;
  const m = MOVES[c.moveId];
  if (!m?.technique) return null;
  const t = c.moveTick;
  // The teleport's active window is a single tick. Hold the vanish frame long enough to read.
  if (m.technique.effect === 'teleport') {
    if (t < m.startup) return 0;
    if (t < m.startup + 8) return 1;
    return 2;
  }
  if (t < m.startup) return 0;
  if (t < m.startup + m.active) {
    const multi = m.technique.effect === 'rush' || m.technique.effect === 'barrage' || m.technique.effect === 'scatter';
    return multi && (t >> 2) % 2 === 1 ? 2 : 1;
  }
  return 2;
}

export function updateAnimations(list: readonly Entity[], inCombat: boolean, victory: boolean): void {
  for (const e of list) {
    const s = e.sprite!;
    let next = animFor(e, inCombat, victory);
    if (s.oneShot) {
      if (s.oneShot.ticks-- > 0 && (next === 'idle' || next === 'walk')) next = s.oneShot.anim;
      else s.oneShot = null;
    }
    if (next === 'idle' && ((s.anim === 'idle' && s.animTicks > IDLE_WAIT_TICKS) || s.anim === 'idle_wait')) next = 'idle_wait';
    if (next !== s.anim) {
      s.anim = next;
      s.animTicks = 0;
    } else s.animTicks++;
    if (s.flashTicks > 0) s.flashTicks--;
    const c = e.combatant;
    s.phaseFrame = c ? techniquePhase(c) : null;
    s.aura = !!c && (c.state === 'CHARGE' || (c.engaged && (c.transformed || !!c.meteo)) || !!c.buff);
  }
}

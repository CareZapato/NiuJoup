import type { Entity } from '../../components';
import { getMove } from '../../content/moves';
import type { MoveDef } from '../../content/types';
import { TICK_DT } from '../../core/loop/FixedLoop';
import { distXZ, vec3 } from '../../core/math';
import { sphereHitsCapsule } from '../collision/shapes';
import type { CombatContext, CombatSystem, ProjectileOpts } from './CombatSystem';
import { isAlive, isHostile } from './targeting';

export function createProjectile(ctx: Pick<CombatContext, 'world' | 'events'>, owner: Entity, move: MoveDef, target: Entity | null, seq: number, opts: Partial<ProjectileOpts> = {}): Entity {
  const pd = move.projectile!;
  const o = owner.transform.pos;
  const yaw = owner.transform.yaw;
  const fx = opts.dirX ?? Math.sin(yaw);
  const fz = opts.dirZ ?? Math.cos(yaw);
  const start = vec3(o.x + fx * 0.6, o.y + (owner.body?.height ?? 1.4) * 0.55 + (opts.lift ?? 0), o.z + fz * 0.6);
  let dx = fx;
  let dy = 0;
  let dz = fz;
  // Spread emissions (scatter) launch along their own fan direction and curve in via homing.
  if (target && opts.dirX === undefined) {
    dx = target.transform.pos.x - start.x;
    dy = target.transform.pos.y + target.body!.height * 0.5 - start.y;
    dz = target.transform.pos.z - start.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
  }
  const e = ctx.world.create({
    stableId: `proj_${seq}`,
    kind: 'projectile',
    transform: { pos: start, prev: vec3(start.x, start.y, start.z), yaw },
    projectile: {
      ownerId: owner.id,
      team: owner.combatant?.team ?? 'player',
      moveId: move.id,
      vel: vec3(dx * pd.speed, dy * pd.speed, dz * pd.speed),
      ticksLeft: pd.lifetimeTicks,
      radius: pd.radius,
      pierce: pd.pierce,
      homing: pd.homing,
      targetId: target ? target.id : -1,
      hits: [],
      visual: pd.visual,
      breaksObstacles: pd.breaksObstacles,
      power: opts.power ?? 1,
      castId: opts.castId ?? -1,
      impactsLeft: opts.impacts ?? (pd.pierce ? 99 : 1),
      rehitTicks: opts.rehitTicks ?? 0,
      lastHitTick: {},
      retarget: opts.retarget ?? false,
      weave: pd.weave ?? 0,
      stopsOnTerrain: pd.stopsOnTerrain ?? true,
      age: 0,
      bossImpactCap: opts.bossImpactCap ?? -1,
    },
  });
  ctx.events.emit('projectileSpawned', { id: e.id, visual: pd.visual });
  return e;
}

/**
 * Projectiles with per-impact identity: each one belongs to a cast, keeps a
 * ledger of when it last hit each target, and spends a limited impact budget,
 * so nothing deals damage every frame and no projectile ever harms its own team.
 */
export class ProjectileSystem {
  constructor(private onObstacle: (proj: Entity) => boolean) {}

  update(ctx: CombatContext, combat: CombatSystem): void {
    const list = ctx.world.query('projectile');
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const p = e.projectile!;
      const pos = e.transform.pos;
      const owner = ctx.world.get(p.ownerId);
      p.age++;
      let target = ctx.world.get(p.targetId);
      if (p.retarget && owner && (!target || !isAlive(target) || this.recentlyHit(p, target, ctx.tick))) {
        target = this.nextTarget(e, owner, ctx) ?? target;
        p.targetId = target ? target.id : -1;
      }
      if (p.homing > 0 && target && isAlive(target)) {
        const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
        const tx = target.transform.pos.x - pos.x;
        const ty = target.transform.pos.y + target.body!.height * 0.5 - pos.y;
        const tz = target.transform.pos.z - pos.z;
        const tl = Math.hypot(tx, ty, tz) || 1;
        const k = Math.min(1, p.homing * TICK_DT);
        p.vel.x += ((tx / tl) * sp - p.vel.x) * k;
        p.vel.y += ((ty / tl) * sp - p.vel.y) * k;
        p.vel.z += ((tz / tl) * sp - p.vel.z) * k;
      }
      let ox = 0;
      let oz = 0;
      if (p.weave > 0) {
        // Finger-guided sphere: lateral sway so its trajectory visibly changes.
        const l = Math.hypot(p.vel.x, p.vel.z) || 1;
        const s = Math.cos(p.age * 0.16) * p.weave * 0.16;
        ox = (-p.vel.z / l) * s;
        oz = (p.vel.x / l) * s;
      }
      pos.x += p.vel.x * TICK_DT + ox;
      pos.y += p.vel.y * TICK_DT;
      pos.z += p.vel.z * TICK_DT + oz;
      e.transform.yaw = Math.atan2(p.vel.x, p.vel.z);
      let dead = --p.ticksLeft <= 0;

      const ground = ctx.map.heightAt(pos.x, pos.z);
      if (!dead && (ground > pos.y || pos.y < -0.5)) {
        if (p.breaksObstacles) this.onObstacle(e);
        if (p.stopsOnTerrain || ground > 50) dead = true;
        else pos.y = ground + 0.3;
      }
      if (!dead && p.breaksObstacles && this.onObstacle(e)) dead = true;

      if (!dead) {
        for (const o of ctx.world.query('combatant')) {
          if (!owner ? !isAlive(o) || o.combatant!.team === p.team : !isHostile(owner, o)) continue;
          if (this.recentlyHit(p, o, ctx.tick)) continue;
          if (!sphereHitsCapsule(pos.x, pos.y, pos.z, p.radius, o.transform.pos, o.body!.height, o.body!.radius)) continue;
          p.lastHitTick[o.id] = ctx.tick;
          if (!p.hits.includes(o.id)) p.hits.push(o.id);
          p.impactsLeft--;
          if (owner) {
            const l = Math.hypot(p.vel.x, p.vel.z) || 1;
            combat.applyHit(owner, o, getMove(p.moveId), p.vel.x / l, p.vel.z / l, ctx, { multiplier: p.power, bossImpactCap: p.bossImpactCap >= 0 ? p.bossImpactCap : undefined });
          }
          if (!p.pierce || p.impactsLeft <= 0) {
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        ctx.events.emit('projectileExploded', { x: pos.x, y: pos.y, z: pos.z, visual: p.visual });
        ctx.world.remove(e.id);
      }
    }
  }

  private recentlyHit(p: NonNullable<Entity['projectile']>, o: Entity, tick: number): boolean {
    const last = p.lastHitTick[o.id];
    if (last === undefined) return false;
    return p.rehitTicks <= 0 || tick - last < p.rehitTicks;
  }

  /** Guided/retargeting projectiles prefer living hostiles they haven't hit yet. */
  private nextTarget(e: Entity, owner: Entity, ctx: CombatContext): Entity | null {
    const p = e.projectile!;
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const o of ctx.world.query('combatant')) {
      if (!isHostile(owner, o)) continue;
      if (this.recentlyHit(p, o, ctx.tick)) continue;
      const score = distXZ(o.transform.pos, e.transform.pos) + (p.hits.includes(o.id) ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }
}

import type { Entity } from '../../components';
import { getMove } from '../../content/moves';
import type { MoveDef } from '../../content/types';
import { TICK_DT } from '../../core/loop/FixedLoop';
import { vec3 } from '../../core/math';
import { sphereHitsCapsule } from '../collision/shapes';
import type { CombatContext, CombatSystem } from './CombatSystem';
import { isAlive } from './targeting';

export function createProjectile(ctx: Pick<CombatContext, 'world' | 'events'>, owner: Entity, move: MoveDef, target: Entity | null, seq: number): Entity {
  const pd = move.projectile!;
  const o = owner.transform.pos;
  const yaw = owner.transform.yaw;
  const start = vec3(o.x + Math.sin(yaw) * 0.6, o.y + (owner.body?.height ?? 1.4) * 0.55, o.z + Math.cos(yaw) * 0.6);
  let dx = Math.sin(yaw);
  let dy = 0;
  let dz = Math.cos(yaw);
  if (target) {
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
      power: move.damage,
    },
  });
  ctx.events.emit('projectileSpawned', { id: e.id, visual: pd.visual });
  return e;
}

export class ProjectileSystem {
  constructor(private onObstacle: (proj: Entity) => boolean) {}

  update(ctx: CombatContext, combat: CombatSystem): void {
    const list = ctx.world.query('projectile');
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const p = e.projectile!;
      const pos = e.transform.pos;
      const target = ctx.world.get(p.targetId);
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
      pos.x += p.vel.x * TICK_DT;
      pos.y += p.vel.y * TICK_DT;
      pos.z += p.vel.z * TICK_DT;
      e.transform.yaw = Math.atan2(p.vel.x, p.vel.z);
      let dead = --p.ticksLeft <= 0;

      if (!dead && (ctx.map.heightAt(pos.x, pos.z) > pos.y || pos.y < -0.5)) {
        if (p.breaksObstacles) this.onObstacle(e);
        dead = true;
      }
      if (!dead && p.breaksObstacles && this.onObstacle(e)) dead = true;

      if (!dead) {
        const owner = ctx.world.get(p.ownerId);
        for (const o of ctx.world.query('combatant')) {
          if (!isAlive(o) || o.combatant!.team === p.team || p.hits.includes(o.id)) continue;
          if (sphereHitsCapsule(pos.x, pos.y, pos.z, p.radius, o.transform.pos, o.body!.height, o.body!.radius)) {
            p.hits.push(o.id);
            if (owner) {
              const l = Math.hypot(p.vel.x, p.vel.z) || 1;
              combat.applyHit(owner, o, getMove(p.moveId), p.vel.x / l, p.vel.z / l, ctx);
            }
            if (!p.pierce) {
              dead = true;
              break;
            }
          }
        }
      }
      if (dead) {
        ctx.events.emit('projectileExploded', { x: pos.x, y: pos.y, z: pos.z, visual: p.visual });
        ctx.world.remove(e.id);
      }
    }
  }
}

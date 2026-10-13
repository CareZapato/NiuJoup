import type { Entity } from '../../components';
import { BALANCE } from '../../content/balance';
import { TICK_DT } from '../../core/loop/FixedLoop';
import { damp, lerpAngle, yawFromDir } from '../../core/math';
import type { TileMap } from '../../world/TileMap';

const X = BALANCE.exploration;

/** Moves a ground body with gravity, step-up and per-axis sliding against terrain. */
export function moveGroundBody(e: Entity, map: TileMap, wantX: number, wantZ: number, speed: number): void {
  const body = e.body!;
  const p = e.transform.pos;
  const k = damp(16, TICK_DT);
  body.vel.x += (wantX * speed - body.vel.x) * k;
  body.vel.z += (wantZ * speed - body.vel.z) * k;
  body.vel.y -= X.gravity * TICK_DT;

  const nx = p.x + body.vel.x * TICK_DT;
  if (map.canOccupy(nx, p.z, p.y, body.radius, X.stepUp, false)) p.x = nx;
  else body.vel.x = 0;
  const nz = p.z + body.vel.z * TICK_DT;
  if (map.canOccupy(p.x, nz, p.y, body.radius, X.stepUp, false)) p.z = nz;
  else body.vel.z = 0;

  p.y += body.vel.y * TICK_DT;
  const ground = map.heightAt(p.x, p.z);
  if (p.y <= ground) {
    // Step up small ledges smoothly; land from jumps.
    p.y = ground;
    body.vel.y = 0;
    body.grounded = true;
  } else {
    body.grounded = p.y - ground < 0.02;
  }
  if (Math.abs(wantX) + Math.abs(wantZ) > 0.1) {
    e.transform.yaw = lerpAngle(e.transform.yaw, yawFromDir(wantX, wantZ), damp(18, TICK_DT));
  }
}

export function tryJump(e: Entity): boolean {
  const body = e.body!;
  if (!body.grounded) return false;
  body.vel.y = X.jumpVelocity;
  body.grounded = false;
  return true;
}

/**
 * Companions follow the leader along a breadcrumb trail, so they walk around
 * obstacles the same way the leader did instead of cutting through walls.
 */
export class PartyTrail {
  private points: { x: number; z: number }[] = [];
  private readonly spacing = 0.35;

  reset(x: number, z: number): void {
    this.points = [{ x, z }];
  }

  record(x: number, z: number): void {
    const last = this.points[0];
    if (!last || Math.hypot(last.x - x, last.z - z) >= this.spacing) {
      this.points.unshift({ x, z });
      if (this.points.length > 60) this.points.pop();
    }
  }

  /** Point `gap` world units behind the leader along the trail. */
  sample(gap: number): { x: number; z: number } | null {
    const idx = Math.min(this.points.length - 1, Math.round(gap / this.spacing));
    return this.points[idx] ?? null;
  }
}

interface Wander {
  /** 0 stand at the slot, 1 walk out, 2 stand there, 3 walk back. */
  phase: 0 | 1 | 2 | 3;
  pause: number;
  tx: number;
  tz: number;
  n: number;
}

const wanders = new Map<number, Wander>();

export function resetCompanionWander(): void {
  wanders.clear();
}

function wanderSpot(id: number, n: number, homeX: number, homeZ: number, map: TileMap, y: number, radius: number): { x: number; z: number } | null {
  for (let k = 0; k < 8; k++) {
    const h = Math.imul((id + 17) ^ Math.imul(n + k + 1, 0x9e3779b9), 0x85ebca6b) >>> 0;
    const ang = (h % 1000) / 159.15;
    const dist = 0.85 + ((h >>> 10) % 65) / 100;
    const x = homeX + Math.cos(ang) * dist;
    const z = homeZ + Math.sin(ang) * dist;
    if (map.canOccupy(x, z, y, radius, X.stepUp, false)) return { x, z };
  }
  return null;
}

function stroll(e: Entity, map: TileMap, homeX: number, homeZ: number): void {
  const p = e.transform.pos;
  const dHome = Math.hypot(homeX - p.x, homeZ - p.z);
  let w = wanders.get(e.id);
  if (!w) {
    w = { phase: dHome > 0.35 ? 3 : 0, pause: 60 * (10 + (e.id % 6)), tx: homeX, tz: homeZ, n: e.id };
    wanders.set(e.id, w);
  }
  if (w.phase === 0 || w.phase === 2) {
    w.pause--;
    moveGroundBody(e, map, 0, 0, 0);
    if (w.pause > 0) return;
    if (w.phase === 0) {
      const spot = wanderSpot(e.id, w.n++, homeX, homeZ, map, p.y, e.body!.radius);
      if (!spot) w.pause = 120;
      else {
        w.tx = spot.x;
        w.tz = spot.z;
        w.phase = 1;
      }
    } else w.phase = 3;
    return;
  }
  const gx = w.phase === 3 ? homeX : w.tx;
  const gz = w.phase === 3 ? homeZ : w.tz;
  const dx = gx - p.x;
  const dz = gz - p.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.22) {
    w.phase = w.phase === 1 ? 2 : 0;
    w.pause = w.phase === 2 ? 60 * (8 + (e.id % 4)) : 60 * (12 + ((e.id + w.n) % 6));
    moveGroundBody(e, map, 0, 0, 0);
    return;
  }
  moveGroundBody(e, map, dx / dist, dz / dist, Math.min(X.walkSpeed * 0.5, dist * 4));
}

export function followTrail(e: Entity, map: TileMap, trail: PartyTrail, slot: number, leaderRunning: boolean, leaderSettled = false): void {
  const target = trail.sample(X.companionFollowGap * (slot + 1));
  const p = e.transform.pos;
  if (!target) {
    wanders.delete(e.id);
    moveGroundBody(e, map, 0, 0, 0);
    return;
  }
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > 12) {
    wanders.delete(e.id);
    // Lost (e.g. after teleport): snap to trail.
    p.x = target.x;
    p.z = target.z;
    p.y = map.heightAt(p.x, p.z);
    e.transform.prev.x = p.x;
    e.transform.prev.z = p.z;
    return;
  }
  if (leaderSettled) {
    stroll(e, map, target.x, target.z);
    return;
  }
  wanders.delete(e.id);
  if (d < 0.25) {
    moveGroundBody(e, map, 0, 0, 0);
    return;
  }
  const speed = leaderRunning || d > 2.5 ? X.runSpeed : X.walkSpeed;
  moveGroundBody(e, map, dx / d, dz / d, Math.min(speed, d * 6));
  // Hop over small obstacles the leader jumped.
  if (e.body!.grounded && map.heightAt(p.x + (dx / d) * 0.5, p.z + (dz / d) * 0.5) > p.y + X.stepUp) e.body!.vel.y = X.jumpVelocity;
}

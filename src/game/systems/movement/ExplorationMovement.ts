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

export function followTrail(e: Entity, map: TileMap, trail: PartyTrail, slot: number, leaderRunning: boolean): void {
  const target = trail.sample(X.companionFollowGap * (slot + 1));
  const p = e.transform.pos;
  if (!target) {
    moveGroundBody(e, map, 0, 0, 0);
    return;
  }
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > 12) {
    // Lost (e.g. after teleport): snap to trail.
    p.x = target.x;
    p.z = target.z;
    p.y = map.heightAt(p.x, p.z);
    e.transform.prev.x = p.x;
    e.transform.prev.z = p.z;
    return;
  }
  if (d < 0.25) {
    moveGroundBody(e, map, 0, 0, 0);
    return;
  }
  const speed = leaderRunning || d > 2.5 ? X.runSpeed : X.walkSpeed;
  moveGroundBody(e, map, dx / d, dz / d, Math.min(speed, d * 6));
  // Hop over small obstacles the leader jumped.
  if (e.body!.grounded && map.heightAt(p.x + (dx / d) * 0.5, p.z + (dz / d) * 0.5) > p.y + X.stepUp) e.body!.vel.y = X.jumpVelocity;
}

import type { Vec3 } from '../../core/math';
import type { Hitbox } from '../../content/types';

/** Distance from point p to the vertical segment at (cx, cz) between y0 and y1. */
export function pointToVerticalSegment(px: number, py: number, pz: number, cx: number, y0: number, y1: number, cz: number): number {
  const y = py < y0 ? y0 : py > y1 ? y1 : py;
  return Math.hypot(px - cx, py - y, pz - cz);
}

/** Sphere vs vertical capsule (hurtbox: feet at pos.y, height h, radius r). */
export function sphereHitsCapsule(sx: number, sy: number, sz: number, sr: number, pos: Vec3, h: number, r: number): boolean {
  return pointToVerticalSegment(sx, sy, sz, pos.x, pos.y + r * 0.5, pos.y + h - r * 0.5, pos.z) <= sr + r;
}

/** World-space center of an attack hitbox, attached to the attacker's facing (not the sprite). */
export function hitboxCenter(out: Vec3, pos: Vec3, yaw: number, bodyHeight: number, scale: number, hb: Hitbox): Vec3 {
  out.x = pos.x + Math.sin(yaw) * hb.forward * scale;
  out.z = pos.z + Math.cos(yaw) * hb.forward * scale;
  out.y = pos.y + bodyHeight * 0.5 + hb.up * scale;
  return out;
}

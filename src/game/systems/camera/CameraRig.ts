import { clamp, damp, easeInOutCubic, lerp, lerpAngle, vec3, type Vec3, wrapAngle } from '../../core/math';

export type CameraMode = 'ExplorationCamera' | 'EncounterCamera' | 'CombatCamera' | 'SpecialAttackCamera';

export interface CameraPose {
  focus: Vec3;
  yaw: number;
  /** Elevation angle in radians (PI/2 = straight down). */
  pitch: number;
  distance: number;
  fov: number;
}

export const makePose = (): CameraPose => ({ focus: vec3(), yaw: 0, pitch: 1, distance: 15, fov: 40 });

export function copyPose(out: CameraPose, a: CameraPose): CameraPose {
  out.focus.x = a.focus.x;
  out.focus.y = a.focus.y;
  out.focus.z = a.focus.z;
  out.yaw = a.yaw;
  out.pitch = a.pitch;
  out.distance = a.distance;
  out.fov = a.fov;
  return out;
}

export function lerpPose(out: CameraPose, a: CameraPose, b: CameraPose, t: number): CameraPose {
  out.focus.x = lerp(a.focus.x, b.focus.x, t);
  out.focus.y = lerp(a.focus.y, b.focus.y, t);
  out.focus.z = lerp(a.focus.z, b.focus.z, t);
  out.yaw = lerpAngle(a.yaw, b.yaw, t);
  out.pitch = lerp(a.pitch, b.pitch, t);
  out.distance = lerp(a.distance, b.distance, t);
  out.fov = lerp(a.fov, b.fov, t);
  return out;
}

/** Camera ground-forward for a yaw: yaw 0 looks north (-Z) so the map reads top-down. */
export const forwardX = (yaw: number): number => -Math.sin(yaw);
export const forwardZ = (yaw: number): number => -Math.cos(yaw);
export const rightX = (yaw: number): number => Math.cos(yaw);
export const rightZ = (yaw: number): number => -Math.sin(yaw);

/** Converts a screen-space stick (x right, y up) into a world XZ direction for the camera yaw. */
export function screenToWorld(out: { x: number; z: number }, sx: number, sy: number, yaw: number): { x: number; z: number } {
  out.x = rightX(yaw) * sx + forwardX(yaw) * sy;
  out.z = rightZ(yaw) * sx + forwardZ(yaw) * sy;
  return out;
}

export function worldToScreen(out: { x: number; y: number }, wx: number, wz: number, yaw: number): { x: number; y: number } {
  out.x = wx * rightX(yaw) + wz * rightZ(yaw);
  out.y = wx * forwardX(yaw) + wz * forwardZ(yaw);
  return out;
}

/** Yaw that puts direction (dx,dz) along screen-right: player left, enemies right. */
export const yawForScreenRight = (dx: number, dz: number): number => Math.atan2(-dz, dx);

export class CameraRig {
  readonly pose = makePose();
  mode: CameraMode = 'ExplorationCamera';
  private from = makePose();
  private blendTicks = 0;
  private blendDuration = 0;
  private trauma = 0;
  private shakeTime = 0;
  readonly position = vec3();
  readonly lookAt = vec3();
  smoothing = 9;
  shakeScale = 1;

  setMode(mode: CameraMode, blendTicks: number): void {
    if (mode === this.mode && this.blendTicks >= this.blendDuration) return;
    this.mode = mode;
    copyPose(this.from, this.pose);
    this.blendTicks = 0;
    this.blendDuration = Math.max(1, blendTicks);
  }

  get blending(): boolean {
    return this.blendTicks < this.blendDuration;
  }

  /** 0..1 progress of the current mode blend. */
  get blendProgress(): number {
    return clamp(this.blendTicks / this.blendDuration, 0, 1);
  }

  snap(p: CameraPose): void {
    copyPose(this.pose, p);
    this.blendTicks = this.blendDuration;
  }

  addTrauma(amount: number): void {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  update(desired: CameraPose, dt: number): void {
    if (this.blendTicks < this.blendDuration) {
      this.blendTicks++;
      lerpPose(this.pose, this.from, desired, easeInOutCubic(this.blendTicks / this.blendDuration));
    } else {
      const k = damp(this.smoothing, dt);
      const p = this.pose;
      p.focus.x += (desired.focus.x - p.focus.x) * k;
      p.focus.y += (desired.focus.y - p.focus.y) * k;
      p.focus.z += (desired.focus.z - p.focus.z) * k;
      p.yaw = p.yaw + wrapAngle(desired.yaw - p.yaw) * k;
      p.pitch += (desired.pitch - p.pitch) * k;
      p.distance += (desired.distance - p.distance) * k;
      p.fov += (desired.fov - p.fov) * k;
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.shakeTime += dt;
  }

  /**
   * Resolves the final camera transform. `heightAt` lets the camera rise above
   * terrain (cliffs, trees) that would otherwise block the view.
   */
  resolve(heightAt: (x: number, z: number) => number): void {
    const p = this.pose;
    const h = Math.cos(p.pitch) * p.distance;
    let x = p.focus.x + Math.sin(p.yaw) * h;
    let z = p.focus.z + Math.cos(p.yaw) * h;
    let y = p.focus.y + Math.sin(p.pitch) * p.distance;
    const terrain = heightAt(x, z);
    if (y < terrain + 0.8) y = terrain + 0.8;
    const s = this.trauma * this.trauma * 0.35 * this.shakeScale;
    if (s > 0) {
      const t = this.shakeTime * 40;
      x += Math.sin(t * 1.3) * s;
      y += Math.sin(t * 1.7 + 1) * s;
      z += Math.sin(t * 1.1 + 2) * s;
    }
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    this.lookAt.x = p.focus.x;
    this.lookAt.y = p.focus.y;
    this.lookAt.z = p.focus.z;
  }
}

import type { ButtonId, NumpadDir } from '../content/types';

export const BUTTON_BITS: Record<ButtonId, number> = {
  light: 1,
  heavy: 2,
  ki: 4,
  guard: 8,
  charge: 16,
  dash: 32,
  up: 64,
  down: 128,
  special: 256,
};

export const ALL_BUTTONS = Object.keys(BUTTON_BITS) as ButtonId[];

export interface InputFrame {
  tick: number;
  dir: NumpadDir;
  held: number;
  pressed: number;
  released: number;
  /** For released buttons: how long they were held. Indexed by button bit position. */
  heldDuration: Int32Array;
}

/**
 * Fixed-size ring buffer of per-tick input frames. Frames are preallocated and
 * reused so recording input never allocates during gameplay.
 */
export class InputBuffer {
  private frames: InputFrame[];
  private head = -1;
  private count = 0;
  private holdStart = new Int32Array(16).fill(-1);

  constructor(readonly capacity = 90) {
    this.frames = Array.from({ length: capacity }, () => ({
      tick: -1,
      dir: 5 as NumpadDir,
      held: 0,
      pressed: 0,
      released: 0,
      heldDuration: new Int32Array(16),
    }));
  }

  push(tick: number, dir: NumpadDir, held: number): InputFrame {
    const prevHeld = this.count > 0 ? this.frames[this.head].held : 0;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    const f = this.frames[this.head];
    f.tick = tick;
    f.dir = dir;
    f.held = held;
    f.pressed = held & ~prevHeld;
    f.released = prevHeld & ~held;
    f.heldDuration.fill(0);
    for (let bit = 0; bit < 16; bit++) {
      const mask = 1 << bit;
      if (f.pressed & mask) this.holdStart[bit] = tick;
      if (f.released & mask) {
        f.heldDuration[bit] = this.holdStart[bit] >= 0 ? tick - this.holdStart[bit] : 0;
        this.holdStart[bit] = -1;
      }
    }
    return f;
  }

  /** i = 0 is the newest frame. */
  at(i: number): InputFrame | null {
    if (i >= this.count) return null;
    return this.frames[(this.head - i + this.capacity * 2) % this.capacity];
  }

  get size(): number {
    return this.count;
  }

  heldTicks(button: ButtonId, now: number): number {
    const bit = Math.log2(BUTTON_BITS[button]);
    return this.holdStart[bit] >= 0 ? now - this.holdStart[bit] : 0;
  }

  clear(): void {
    this.count = 0;
    this.head = -1;
    this.holdStart.fill(-1);
  }
}

/**
 * Converts a screen-space stick vector into numpad notation relative to the
 * target's on-screen direction (tx,ty). With the target to the right, D = 6
 * (toward) and W = 8, like a 2D fighter; it mirrors when sides switch, so
 * commands keep working while the camera orbits.
 */
export function relativeDir(sx: number, sy: number, tx: number, ty: number, threshold = 0.38): NumpadDir {
  const len = Math.hypot(sx, sy);
  if (len < 0.25) return 5;
  const ix = sx / len;
  const iy = sy / len;
  const tl = Math.hypot(tx, ty) || 1;
  const fx = tx / tl;
  const fy = ty / tl;
  const fwd = ix * fx + iy * fy;
  // Perpendicular rotated so that "up" stays up when the target is on either side.
  const sign = fx >= 0 ? 1 : -1;
  const lat = (ix * -fy + iy * fx) * sign;
  const col = fwd > threshold ? 2 : fwd < -threshold ? 0 : 1;
  const row = lat > threshold ? 2 : lat < -threshold ? 0 : 1;
  return (row * 3 + col + 1) as NumpadDir;
}

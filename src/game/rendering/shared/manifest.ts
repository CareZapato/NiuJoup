import type { AnimId } from '../../components';

/**
 * Sprite manifest format. Generated placeholders and future hand-made PNG
 * atlases share this schema, so real art can replace placeholders without
 * touching game code. See ASSET_PIPELINE.md.
 */
export interface AnimDef {
  frames: number;
  fps: number;
  loop: boolean;
  /** Frame index -> named event (e.g. footstep, impact) for audio/VFX hooks. */
  events?: Record<number, string>;
}

export interface SpriteManifest {
  id: string;
  frameWidth: number;
  frameHeight: number;
  /** Pivot in pixels from the frame's top-left (feet position). */
  pivot: { x: number; y: number };
  /** Unique views stored in rows; mirrored views reuse them flipped horizontally. */
  views: ViewId[];
  anims: Partial<Record<AnimId, AnimDef>>;
  /** Column offset of each animation's first frame (computed). */
  columns: Partial<Record<AnimId, number>>;
  totalColumns: number;
  /** Hurtbox in pixels relative to pivot, for authoring/validation tools. */
  hurtbox: { width: number; height: number };
}

/** S = facing camera, E = profile facing right, N = back; SE/NE = three-quarter views. */
export type ViewId = 'S' | 'SE' | 'E' | 'NE' | 'N';

export const WORLD_ANIMS: Partial<Record<AnimId, AnimDef>> = {
  idle: { frames: 2, fps: 2, loop: true },
  walk: { frames: 4, fps: 8, loop: true, events: { 1: 'footstep', 3: 'footstep' } },
  run: { frames: 4, fps: 12, loop: true, events: { 1: 'footstep', 3: 'footstep' } },
  jump: { frames: 1, fps: 1, loop: false },
  interact: { frames: 1, fps: 1, loop: false },
  hit: { frames: 1, fps: 1, loop: false },
  defeat: { frames: 1, fps: 1, loop: false },
};

export const BATTLE_ANIMS: Partial<Record<AnimId, AnimDef>> = {
  idle: { frames: 2, fps: 3, loop: true },
  hover: { frames: 2, fps: 3, loop: true },
  fly: { frames: 2, fps: 8, loop: true },
  punch: { frames: 3, fps: 18, loop: false, events: { 1: 'impact' } },
  kick: { frames: 3, fps: 14, loop: false, events: { 1: 'impact' } },
  guard: { frames: 1, fps: 1, loop: false },
  hit: { frames: 1, fps: 1, loop: false },
  knockback: { frames: 1, fps: 1, loop: false },
  dash: { frames: 1, fps: 1, loop: false },
  charge: { frames: 2, fps: 10, loop: true },
  kiblast: { frames: 2, fps: 10, loop: false, events: { 1: 'release' } },
  special: { frames: 2, fps: 6, loop: true },
  defeat: { frames: 1, fps: 1, loop: false },
  victory: { frames: 2, fps: 3, loop: true },
};

export function buildManifest(id: string, fw: number, fh: number, views: ViewId[], anims: Partial<Record<AnimId, AnimDef>>): SpriteManifest {
  const columns: Partial<Record<AnimId, number>> = {};
  let col = 0;
  for (const [k, a] of Object.entries(anims) as [AnimId, AnimDef][]) {
    columns[k] = col;
    col += a.frames;
  }
  return { id, frameWidth: fw, frameHeight: fh, pivot: { x: fw / 2, y: fh - 2 }, views, anims, columns, totalColumns: col, hurtbox: { width: fw * 0.4, height: fh * 0.9 } };
}

/** Frame index for an animation at a given tick count (60 ticks/s). */
export function frameAt(a: AnimDef, ticks: number): number {
  const f = Math.floor((ticks / 60) * a.fps);
  return a.loop ? f % a.frames : Math.min(a.frames - 1, f);
}

/**
 * Picks the stored view + mirroring for an entity facing `yaw` seen from a
 * camera at `cameraYaw` (directional billboard, 8 directions).
 */
export function pickView(yaw: number, cameraYaw: number, views: ViewId[]): { row: number; mirror: boolean } {
  // Angle of the entity's facing relative to the direction pointing at the camera.
  const camDirYaw = Math.atan2(Math.sin(cameraYaw), Math.cos(cameraYaw));
  let rel = yaw - camDirYaw;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const octant = Math.round(rel / (Math.PI / 4)); // 0 = facing camera
  const abs = Math.abs(octant);
  const want: ViewId = abs === 0 ? 'S' : abs === 1 ? 'SE' : abs === 2 ? 'E' : abs === 3 ? 'NE' : 'N';
  let row = views.indexOf(want);
  if (row < 0) {
    const fallback: Record<ViewId, ViewId> = { S: 'S', SE: 'S', E: 'E', NE: 'N', N: 'N' };
    row = views.indexOf(fallback[want]);
    if (row < 0) row = 0;
  }
  // rel = +PI/2 faces screen-right (art is authored facing right); negative octants mirror it.
  return { row, mirror: octant < 0 && want !== 'S' && want !== 'N' };
}

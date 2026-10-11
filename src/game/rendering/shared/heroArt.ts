import type { AnimId } from '../../components';
import type { AppearanceDef } from '../../content/types';
import type { GeneratedAtlas } from './characterArt';
import { type AnimDef, buildManifest, frameRect, type ViewId } from './manifest';
import { PixelCanvas, shade } from './PixelCanvas';

/**
 * Detailed procedural pixel art for the three heroes (64×96 px frames, drawn
 * in a 32×48 design space at 2 px per unit so features can use half units).
 * Silhouettes follow the reference sheets: Turtle School orange gi with blue
 * undershirt, belt and wristbands, blue boots; Goku's spiky hair, Krillin bald
 * with six forehead dots (shorter, via sprite scale), Yamcha's long spiky hair
 * and scars. These are original placeholder sprites, not final hand-made art.
 */

type P2 = [number, number];
type Fx = 'kame' | 'disc' | 'flash' | 'orb' | 'ball';
type Eyes = 'open' | 'closed' | 'dizzy' | 'fierce';

interface HeroPose {
  bob: number;
  lean: number;
  armF: P2;
  armB: P2;
  legF: P2;
  legB: P2;
  fist?: boolean;
  fx?: Fx;
  fxPower?: number;
  /** Fx anchored at the front hand (default) or above it. */
  fxAt?: 'hand' | 'above' | 'face' | 'between';
  headDy?: number;
  tilt?: number;
  eyes?: Eyes;
  /** Body rotation for falls / lying down, in design units of horizontal shear. */
  shear?: number;
}

const REST: HeroPose = { bob: 0, lean: 0, armF: [2, 10], armB: [-2, 10], legF: [1.5, 16], legB: [-1.5, 16] };
const p = (o: Partial<HeroPose>): HeroPose => ({ ...REST, ...o });

const STANCE: Partial<HeroPose> = { lean: 1, armF: [5, 1.5], armB: [3, 3.5], legF: [4, 15.8], legB: [-4, 15.8], fist: true, eyes: 'fierce' };

export const HERO_ANIMS: Partial<Record<AnimId, AnimDef>> = {
  idle: { frames: 4, fps: 3, loop: true },
  idle_wait: { frames: 4, fps: 2, loop: true },
  walk: { frames: 4, fps: 8, loop: true, events: { 1: 'footstep', 3: 'footstep' } },
  run: { frames: 4, fps: 12, loop: true, events: { 1: 'footstep', 3: 'footstep' } },
  jump: { frames: 1, fps: 1, loop: false },
  pickup: { frames: 2, fps: 4, loop: false, events: { 0: 'pickup' } },
  interact: { frames: 1, fps: 1, loop: false },
  stance: { frames: 2, fps: 3, loop: true },
  hover: { frames: 2, fps: 3, loop: true },
  fly: { frames: 2, fps: 8, loop: true },
  punch: { frames: 3, fps: 18, loop: false, events: { 1: 'impact' } },
  kick: { frames: 3, fps: 14, loop: false, events: { 1: 'impact' } },
  guard: { frames: 1, fps: 1, loop: false },
  dodge: { frames: 2, fps: 10, loop: false },
  dash: { frames: 1, fps: 1, loop: false },
  charge: { frames: 2, fps: 10, loop: true },
  kiblast: { frames: 2, fps: 10, loop: false, events: { 1: 'release' } },
  hit: { frames: 1, fps: 1, loop: false },
  confused: { frames: 2, fps: 4, loop: true },
  knockback: { frames: 1, fps: 1, loop: false },
  fall: { frames: 1, fps: 1, loop: false },
  defeat: { frames: 1, fps: 1, loop: false },
  victory: { frames: 2, fps: 3, loop: true },
  special: { frames: 2, fps: 6, loop: true },
  tech_kamehameha: { frames: 3, fps: 4, loop: false, events: { 1: 'release' } },
  tech_kienzan: { frames: 3, fps: 4, loop: false, events: { 1: 'release' } },
  tech_taiyoken: { frames: 3, fps: 4, loop: false, events: { 1: 'release' } },
  tech_sokidan: { frames: 3, fps: 4, loop: false, events: { 1: 'release' } },
  tech_wolf_fang: { frames: 3, fps: 8, loop: false, events: { 1: 'release' } },
  tech_kaioken: { frames: 2, fps: 8, loop: true, events: { 1: 'release' } },
  tech_barrage: { frames: 3, fps: 10, loop: false, events: { 1: 'release' } },
};

/** Frames per animation; technique frames are prep / release / recovery. */
const POSES: Record<keyof typeof HERO_ANIMS, HeroPose[]> = {
  idle: [p({}), p({ bob: 0.3, armF: [2, 9.7], armB: [-2, 9.7] }), p({ bob: 0.6, armF: [2.2, 9.5], armB: [-2.2, 9.5] }), p({ bob: 0.3 })],
  idle_wait: [
    p({ armF: [2, -7], armB: [-2, 10], headDy: 0.3, tilt: 0.6 }),
    p({ armF: [2.5, -7.5], armB: [-2, 10], headDy: 0.3, tilt: 0.8 }),
    p({ armF: [3, 8], armB: [-3, 8], tilt: -1, eyes: 'closed' }),
    p({ armF: [3, 8], armB: [-3, 8], tilt: 1 }),
  ],
  walk: [
    p({ legF: [4, 15.5], legB: [-4, 15.5], armF: [-3, 9.5], armB: [3, 9.5] }),
    p({ bob: -0.6, legF: [0.5, 15], legB: [-0.5, 16] }),
    p({ legF: [-4, 15.5], legB: [4, 15.5], armF: [3, 9.5], armB: [-3, 9.5] }),
    p({ bob: -0.6, legF: [-0.5, 16], legB: [0.5, 15] }),
  ],
  run: [
    p({ lean: 2.5, legF: [6, 14], legB: [-6, 13], armF: [-5, 6], armB: [5, 6], fist: true }),
    p({ lean: 2.5, bob: -1.2, legF: [1, 12], legB: [-2, 15], fist: true }),
    p({ lean: 2.5, legF: [-6, 13], legB: [6, 14], armF: [5, 6], armB: [-5, 6], fist: true }),
    p({ lean: 2.5, bob: -1.2, legF: [-2, 15], legB: [1, 12], fist: true }),
  ],
  jump: [p({ bob: -2, legF: [4, 11], legB: [-2, 12], armF: [4, -6], armB: [-4, -5], fist: true })],
  pickup: [p({ bob: 4, lean: 3, legF: [5, 12], legB: [-3, 12.5], armF: [7, 11], armB: [-2, 7], headDy: 0.5 }), p({ armF: [4, -1], armB: [-2, 10] })],
  interact: [p({ armF: [9, 3] })],
  stance: [p(STANCE), p({ ...STANCE, bob: 0.5 })],
  hover: [p({ legF: [1.5, 14.5], legB: [-1, 13.5], armF: [3, 8], armB: [-3, 8] }), p({ bob: -1, legF: [1.5, 14.5], legB: [-1, 13.5], armF: [3, 8], armB: [-3, 8] })],
  fly: [
    p({ lean: 5, legF: [-6, 12], legB: [-8, 10.5], armF: [9, 1], armB: [-6, 6], fist: true }),
    p({ lean: 5, bob: -0.6, legF: [-7, 11.5], legB: [-8.5, 10], armF: [9, 0.5], armB: [-6, 5], fist: true }),
  ],
  punch: [
    p({ ...STANCE, lean: -1, armF: [-2, 5], armB: [3, 4] }),
    p({ ...STANCE, lean: 2.5, armF: [11.5, 0], armB: [-3, 6], legF: [5, 15.5] }),
    p({ ...STANCE, lean: 1, armF: [6, 3] }),
  ],
  kick: [
    p({ ...STANCE, legF: [6, 9], armF: [3, 2], armB: [-4, 4] }),
    p({ ...STANCE, lean: -2, legF: [12.5, 3], armF: [-2, 3], armB: [-6, 2] }),
    p({ ...STANCE, legF: [6, 11], armF: [3, 4], armB: [-3, 5] }),
  ],
  guard: [p({ lean: -1, armF: [6, -2], armB: [5, 0], fist: true, legF: [3, 16], legB: [-3.5, 16], eyes: 'fierce' })],
  dodge: [p({ bob: -1.5, lean: -4, legF: [3, 12], legB: [-4, 13], armF: [-3, 4], armB: [-5, 5] }), p({ bob: -0.5, lean: -2, legF: [2, 14], legB: [-3, 15], armF: [2, 4], armB: [-2, 6], fist: true })],
  dash: [p({ lean: 6, armF: [-7, 6], armB: [-8, 5], legF: [-7, 12], legB: [-8, 11] })],
  charge: [
    p({ bob: 0.8, armF: [4, 10], armB: [-4, 10], legF: [4.5, 15.5], legB: [-4.5, 15.5], fist: true, eyes: 'fierce', headDy: -0.4 }),
    p({ bob: 1.2, armF: [4.5, 10.3], armB: [-4.5, 10.3], legF: [4.5, 15.5], legB: [-4.5, 15.5], fist: true, eyes: 'fierce', headDy: -0.5 }),
  ],
  kiblast: [p({ ...STANCE, lean: -1, armF: [-3, 7], armB: [-4, 7] }), p({ ...STANCE, lean: 1.5, armF: [11, 1.5], armB: [9, 3], fist: false, fx: 'ball', fxPower: 0.6 })],
  hit: [p({ lean: -2.5, headDy: 1, armF: [-4, 5], armB: [-6, 4], legF: [3, 15.5], eyes: 'closed' })],
  confused: [
    p({ bob: 0.6, lean: -1, tilt: 1.4, armF: [3, 11], armB: [-3, 11], legF: [2.5, 16], legB: [-2, 15.6], eyes: 'dizzy' }),
    p({ bob: 0.3, lean: 1, tilt: -1.4, armF: [2, 11], armB: [-4, 10.5], legF: [1, 15.6], legB: [-3, 16], eyes: 'dizzy' }),
  ],
  knockback: [p({ lean: -4, headDy: 1, armF: [-6, -4], armB: [-7, -2], legF: [5, 12], legB: [3, 13], eyes: 'closed' })],
  fall: [p({ bob: -1, lean: -6, shear: -3, armF: [-5, -6], armB: [-7, -3], legF: [7, 9], legB: [5, 11], eyes: 'closed' })],
  defeat: [p({ bob: 7, lean: 3, headDy: 2, legF: [6, 8], legB: [5, 9], armF: [4, 10], armB: [2, 9], eyes: 'closed' })],
  victory: [p({ armF: [2, -12], fist: true, legF: [3, 16], legB: [-3, 16] }), p({ bob: -0.8, armF: [2, -12.5], fist: true, legF: [3, 16], legB: [-3, 16] })],
  special: [p({ armF: [4, -10], armB: [-3, -10], fx: 'ball', fxPower: 0.8 }), p({ lean: 2, armF: [10, 1], armB: [9, 2], fx: 'ball', fxPower: 1 })],
  tech_kamehameha: [
    p({ bob: 1, lean: -1.5, armF: [-5.5, 8.5], armB: [-6.5, 7.5], legF: [5, 15.2], legB: [-5, 15.2], fx: 'kame', fxPower: 0.55, fxAt: 'between', eyes: 'fierce' }),
    p({ bob: 0.6, lean: 2.5, armF: [11.5, 1.5], armB: [10.5, 2.5], legF: [5.5, 15.2], legB: [-5.5, 15.2], fx: 'kame', fxPower: 1, fxAt: 'between', eyes: 'fierce' }),
    p({ lean: 1, armF: [7, 4], armB: [6, 5], legF: [4.5, 15.5], legB: [-4.5, 15.5], eyes: 'fierce' }),
  ],
  tech_kienzan: [
    p({ lean: -0.5, armF: [1.5, -13.5], armB: [-3, 8], legF: [3.5, 15.8], legB: [-3.5, 15.8], fx: 'disc', fxPower: 0.8, fxAt: 'above', eyes: 'fierce' }),
    p({ lean: 3, armF: [11, 3], armB: [-5, 6], legF: [5, 15.5], legB: [-4, 15.5], eyes: 'fierce' }),
    p({ lean: 1, armF: [7, 6], armB: [-3, 8], legF: [3.5, 15.8], legB: [-3.5, 15.8] }),
  ],
  tech_taiyoken: [
    p({ armF: [3, -6.5], armB: [2, -6.5], legF: [3, 16], legB: [-3, 16], eyes: 'closed' }),
    p({ armF: [3.5, -6.5], armB: [2.5, -6.5], legF: [3, 16], legB: [-3, 16], eyes: 'closed', fx: 'flash', fxPower: 1, fxAt: 'face' }),
    p({ armF: [6, 4], armB: [-5, 4], legF: [3, 16], legB: [-3, 16] }),
  ],
  tech_sokidan: [
    p({ ...STANCE, armF: [7, 4], armB: [-3, 6], fist: false, fx: 'orb', fxPower: 0.7, fxAt: 'above' }),
    p({ ...STANCE, lean: 2, armF: [11, -0.5], armB: [-4, 5], fist: false, fx: 'orb', fxPower: 0.45 }),
    p({ ...STANCE, armF: [9, 1], armB: [-3, 6], fist: false }),
  ],
  tech_wolf_fang: [
    p({ bob: 1, lean: 3, armF: [6, -2], armB: [4, 0], legF: [5, 14.5], legB: [-5, 15], fist: false, eyes: 'fierce' }),
    p({ lean: 4.5, armF: [12, 1], armB: [-4, 4], legF: [7, 14.5], legB: [-6, 14], fist: false, eyes: 'fierce' }),
    p({ lean: 4, armF: [-3, 5], armB: [11.5, 2.5], legF: [6, 14.5], legB: [-6.5, 14.2], fist: false, eyes: 'fierce' }),
  ],
  tech_kaioken: [
    p({ bob: 1, armF: [5, 10], armB: [-5, 10], legF: [5, 15.3], legB: [-5, 15.3], fist: true, eyes: 'fierce', headDy: -0.6 }),
    p({ bob: 1.4, armF: [5.5, 9.6], armB: [-5.5, 9.6], legF: [5, 15.3], legB: [-5, 15.3], fist: true, eyes: 'fierce', headDy: -0.8 }),
  ],
  tech_barrage: [
    p({ ...STANCE, lean: -1, armF: [-3, 6], armB: [-4, 6], fist: false }),
    p({ ...STANCE, lean: 2, armF: [11.5, 1], armB: [-3, 6], fist: false, fx: 'ball', fxPower: 0.7 }),
    p({ ...STANCE, lean: 2, armF: [-3, 6], armB: [11, 2], fist: false, fx: 'ball', fxPower: 0.7 }),
  ],
};

interface Build {
  head: number;
  torso: number;
  limb: number;
  /** Leg length multiplier (Krillin's shorter legs). */
  legs: number;
}

const BUILDS: Record<'goku' | 'krillin' | 'yamcha', Build> = {
  goku: { head: 5.2, torso: 10, limb: 3.1, legs: 1 },
  krillin: { head: 5.7, torso: 9.4, limb: 2.9, legs: 0.8 },
  yamcha: { head: 5.1, torso: 9.8, limb: 3, legs: 1.02 },
};

const VIEW_TURN: Record<ViewId, { turn: number; back: boolean }> = {
  S: { turn: 0, back: false },
  SE: { turn: 0.55, back: false },
  E: { turn: 1, back: false },
  NE: { turn: 0.55, back: true },
  N: { turn: 0, back: true },
};

const EYE = 0x1a1420;
const WHITE = 0xfaf6ee;

const lerp2 = (a: P2, b: P2, t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Spike tips relative to the head centre, front and profile; 3/4 views blend them. */
const GOKU_SPIKES: { front: P2; side: P2; w: number }[] = [
  { front: [-7.5, -3.5], side: [-9.5, -1.5], w: 0.42 },
  { front: [-6.8, -8.8], side: [-8.8, -6.5], w: 0.4 },
  { front: [-3.6, -12.2], side: [-5, -11], w: 0.38 },
  { front: [0, -13.2], side: [-0.8, -12.6], w: 0.36 },
  { front: [3.7, -11.8], side: [2.8, -10.4], w: 0.38 },
  { front: [6.8, -8.2], side: [4.8, -7.2], w: 0.4 },
  { front: [7.6, -3.2], side: [-10, 3], w: 0.42 },
  { front: [-8.4, 1.2], side: [-8, 5], w: 0.3 },
  { front: [8.4, 1.6], side: [-5.5, 6], w: 0.3 },
];

const YAMCHA_SPIKES: { front: P2; side: P2; w: number }[] = [
  { front: [-7, 7.5], side: [-7.5, 8], w: 0.45 },
  { front: [7, 7.5], side: [-9, 3.5], w: 0.45 },
  { front: [-8.2, 2], side: [-9.2, -1.5], w: 0.4 },
  { front: [8.2, 2], side: [-7.5, -6.5], w: 0.4 },
  { front: [-4.5, -9], side: [-3.5, -10], w: 0.42 },
  { front: [0, -10.2], side: [0.5, -9.8], w: 0.4 },
  { front: [4.5, -9], side: [3, -8], w: 0.42 },
];

function spike(pc: PixelCanvas, hx: number, hy: number, r: number, tip: P2, w: number, c: number): void {
  const a = Math.atan2(tip[1], tip[0]);
  const br = r * 0.78;
  pc.tri(hx + Math.cos(a - w) * br, hy + Math.sin(a - w) * br, hx + Math.cos(a + w) * br, hy + Math.sin(a + w) * br, hx + tip[0], hy + tip[1], c);
}

function drawHair(pc: PixelCanvas, hero: keyof typeof BUILDS, app: AppearanceDef, hx: number, hy: number, r: number, view: ViewId): void {
  const { turn, back } = VIEW_TURN[view];
  const hair = app.palette.hair;
  const hs = shade(hair === 0 ? 0x2a2a3a : hair, 1.6);
  if (hero === 'krillin') {
    // Bald: shine highlight and the six incense-burn dots.
    pc.ellipse(hx - 1.6 + turn * 1.2, hy - 3.2, 1.6, 1, shade(app.palette.skin, 1.16));
    if (back) return;
    const dot = shade(app.palette.skin, 0.62);
    const cols = turn >= 1 ? [1.6, 2.8, 4] : turn > 0 ? [-0.2, 1.3, 2.8] : [-1.6, 0, 1.6];
    for (const dy of [-4.7, -3.3]) for (const dx of cols) pc.rect(hx + dx - 0.3, hy + dy, 0.7, 0.7, dot);
    return;
  }
  const spikes = hero === 'goku' ? GOKU_SPIKES : YAMCHA_SPIKES;
  // Cap: stops above the brows so the eyes stay visible from the front.
  pc.ellipse(hx - turn * 0.8, hy - 3.7, r + 0.7, 2.6, hair, hs);
  if (turn > 0) pc.ellipse(hx - turn * 2.2, hy - 1.6, r * 0.62 * turn + 0.5, r * 0.7, hair, hs);
  if (back) pc.ellipse(hx, hy - 0.4, r + 0.5, r * 0.98, hair, hs);
  const mirror = back ? -1 : 1;
  for (const s of spikes) {
    const t = lerp2(s.front, s.side, Math.min(1, turn));
    spike(pc, hx - turn * 0.8, hy - 1.5, r, [t[0] * (turn > 0 ? 1 : mirror), t[1]], s.w, hair);
  }
  if (back && hero === 'goku') {
    for (const tx of [-4, 0, 4]) spike(pc, hx, hy, r, [tx, 6.5], 0.35, hair);
  }
  if (!back) {
    // Bangs over the forehead.
    const bangs: P2[] = hero === 'goku' ? [[-3, -1.3], [0.2, -1.6], [3, -1.4]] : [[-2.2, -0.6], [1.4, -0.2]];
    for (const b of bangs) {
      const bx = hx + b[0] * (1 - turn * 0.6) + turn * 2.6;
      pc.tri(bx - 1.4, hy - 3.6, bx + 1.4, hy - 3.6, bx + (turn > 0 ? 1.2 : 0), hy + b[1], hair);
    }
    // A single highlight strand for volume.
    pc.limb(hx - 2 + turn, hy - 5.2, hx + 1 + turn, hy - 5.8, 0.6, hs);
  }
}

function drawFace(pc: PixelCanvas, hero: keyof typeof BUILDS, app: AppearanceDef, hx: number, hy: number, eyes: Eyes, view: ViewId): void {
  const { turn, back } = VIEW_TURN[view];
  const skinD = shade(app.palette.skin, 0.68);
  if (back) {
    pc.ellipse(hx - 5, hy + 0.6, 0.9, 1.4, shade(app.palette.skin, 0.9));
    pc.ellipse(hx + 5, hy + 0.6, 0.9, 1.4, shade(app.palette.skin, 0.9));
    return;
  }
  const brow = (x: number, y: number, flip: number): void => {
    if (eyes === 'fierce') pc.tri(x - 1 * flip, y - 0.2, x + 1.1 * flip, y + 0.5, x + 1.1 * flip, y - 0.4, EYE);
    else pc.rect(x - 0.8, y - 0.2, 1.7, 0.5, EYE);
  };
  const eye = (x: number, y: number): void => {
    if (eyes === 'closed') pc.rect(x - 0.6, y + 0.6, 1.4, 0.5, EYE);
    else if (eyes === 'dizzy') {
      pc.limb(x - 0.6, y, x + 0.8, y + 1.4, 0.45, EYE);
      pc.limb(x + 0.8, y, x - 0.6, y + 1.4, 0.45, EYE);
    } else {
      pc.rect(x - 0.5, y, 1.1, 1.7, EYE);
      pc.rect(x - 0.5, y, 0.5, 0.5, WHITE);
    }
  };
  if (turn < 0.9) {
    const off = turn * 2.4;
    const ex = [hx - 2.2 + off, hx + 1.7 + off];
    eye(ex[0], hy + 0.3);
    eye(ex[1], hy + 0.3);
    brow(ex[0], hy - 0.9, 1);
    brow(ex[1], hy - 0.9, -1);
    // Ears.
    pc.ellipse(hx - 5 + off * 0.6, hy + 0.8, hero === 'krillin' ? 1.2 : 0.9, 1.4, shade(app.palette.skin, 0.92));
    if (turn < 0.3) pc.ellipse(hx + 5, hy + 0.8, hero === 'krillin' ? 1.2 : 0.9, 1.4, shade(app.palette.skin, 0.92));
    if (hero !== 'krillin') pc.rect(hx - 0.2 + off * 1.2, hy + 2, 0.6, 0.6, skinD);
    pc.rect(hx - 0.7 + off * 1.1, hy + 3.3, eyes === 'fierce' ? 1.8 : 1.4, 0.5, shade(app.palette.skin, 0.55));
    if (hero === 'yamcha') {
      // Scar over the left eye and the X on the right cheek.
      pc.limb(ex[1] + 0.9, hy - 2, ex[1] + 0.3, hy + 2.4, 0.4, skinD);
      pc.limb(ex[0] - 1, hy + 2.2, ex[0] + 0.2, hy + 3.4, 0.35, skinD);
      pc.limb(ex[0] + 0.2, hy + 2.2, ex[0] - 1, hy + 3.4, 0.35, skinD);
    }
  } else {
    eye(hx + 2.5, hy + 0.3);
    brow(hx + 2.5, hy - 0.9, -1);
    pc.ellipse(hx - 0.8, hy + 0.8, hero === 'krillin' ? 1.4 : 1.1, 1.5, shade(app.palette.skin, 0.9));
    if (hero !== 'krillin') pc.tri(hx + 4.6, hy + 0.8, hx + 4.6, hy + 2.4, hx + 5.8, hy + 2.2, app.palette.skin);
    pc.rect(hx + 3.4, hy + 3.3, 1.2, 0.5, shade(app.palette.skin, 0.55));
    if (hero === 'yamcha') pc.limb(hx + 3.2, hy - 2, hx + 2.6, hy + 2.4, 0.4, skinD);
  }
}

function drawArm(pc: PixelCanvas, app: AppearanceDef, sx: number, sy: number, hx: number, hy: number, thick: number, dark: boolean, fist: boolean): void {
  const f = dark ? 0.74 : 1;
  const gi = shade(app.palette.outfit, f);
  const skin = shade(app.palette.skin, f);
  const band = shade(app.palette.accent, f);
  // Slight elbow bend away from the body.
  const mx = (sx + hx) / 2 + (hy - sy) * 0.08;
  const my = (sy + hy) / 2 - (hx - sx) * 0.08;
  pc.limb(sx, sy, mx, my, thick, skin, shade(skin, 0.84));
  pc.limb(mx, my, hx, hy, thick * 0.92, skin, shade(skin, 0.84));
  // Blue undershirt sleeve under the gi shoulder.
  pc.limb(sx, sy, sx + (mx - sx) * 0.55, sy + (my - sy) * 0.55, thick + 0.5, band, shade(band, 0.8));
  pc.ellipse(sx, sy + 0.2, thick * 0.75, thick * 0.62, gi, shade(gi, 0.8));
  // Wristband.
  const wx = mx + (hx - mx) * 0.66;
  const wy = my + (hy - my) * 0.66;
  pc.limb(wx, wy, mx + (hx - mx) * 0.86, my + (hy - my) * 0.86, thick + 0.5, band, shade(band, 0.78));
  pc.ellipse(hx, hy, fist ? thick * 0.72 : thick * 0.58, fist ? thick * 0.68 : thick * 0.58, skin, shade(skin, 0.86));
  if (fist) pc.rect(hx - thick * 0.3, hy - 0.2, thick * 0.6, 0.4, shade(skin, 0.72));
}

function drawLeg(pc: PixelCanvas, app: AppearanceDef, hx: number, hy: number, fx: number, fy: number, thick: number, dark: boolean): void {
  const f = dark ? 0.74 : 1;
  const gi = shade(app.palette.outfit, f);
  const giD = shade(app.palette.outfitDark, f);
  const boot = shade(app.palette.boots, f);
  const kx = (hx + fx) / 2 + 0.8;
  const ky = (hy + fy) / 2;
  // Baggy gi trousers tapering into the boots.
  pc.limb(hx, hy, kx, ky, thick + 2.3, gi, giD);
  pc.limb(kx, ky, fx, fy - 2.4, thick + 1.5, gi, giD);
  pc.limb(fx, fy - 3, fx + 0.3, fy - 0.6, thick + 0.4, boot, shade(boot, 0.75));
  pc.rect(fx - (thick + 0.4) / 2, fy - 3.2, thick + 0.4, 0.7, shade(boot, 1.35));
  pc.ellipse(fx + 0.9, fy - 0.6, thick * 0.85, thick * 0.42, boot, shade(boot, 0.75));
}

function drawFx(pc: PixelCanvas, app: AppearanceDef, kind: Fx, x: number, y: number, power: number): void {
  const k = Math.max(0.2, power);
  switch (kind) {
    case 'kame':
      pc.ellipse(x, y, 3.4 * k, 3.4 * k, 0x5ab8ff);
      pc.ellipse(x, y, 2.3 * k, 2.3 * k, 0xa8e4ff);
      pc.ellipse(x, y, 1.2 * k, 1.2 * k, WHITE);
      break;
    case 'disc':
      pc.ellipse(x, y, 4.6 * k, 1.3 * k, 0xffd84a);
      pc.ellipse(x, y, 3.2 * k, 0.7 * k, 0xfff6c0);
      break;
    case 'flash':
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pc.limb(x, y, x + Math.cos(a) * 6 * k, y + Math.sin(a) * 6 * k, 0.8, 0xfffbe0);
      }
      pc.ellipse(x, y, 3 * k, 3 * k, WHITE);
      break;
    case 'orb':
      pc.ellipse(x, y, 2.8 * k, 2.8 * k, shade(app.palette.aura, 0.9));
      pc.ellipse(x - 0.5, y - 0.5, 1.6 * k, 1.6 * k, WHITE);
      break;
    case 'ball':
      pc.ellipse(x, y, 2 * k, 2 * k, shade(app.palette.aura, 1));
      pc.ellipse(x, y, 1 * k, 1 * k, WHITE);
      break;
  }
}

function drawHero(pc: PixelCanvas, hero: keyof typeof BUILDS, app: AppearanceDef, pose: HeroPose, view: ViewId): void {
  const b = BUILDS[hero];
  const { turn, back } = VIEW_TURN[view];
  const pal = app.palette;
  const cx = 16;
  const bob = pose.bob;
  const lean = pose.lean * turn;
  const legLen = 16 * b.legs;
  const hipY = 46 - legLen + bob - 0.4;
  const shoulderY = hipY - 11;
  const torsoX = cx + lean * 0.6;
  const headX = cx + lean + turn * 0.8 + (pose.tilt ?? 0);
  const headY = shoulderY - b.head - 2 + (pose.headDy ?? 0);
  const shear = (pose.shear ?? 0) * turn;

  const sideArm = (a: P2, sign: number): P2 => {
    if (turn >= 1) return a;
    const out = sign * (b.torso / 2 + 1 + Math.max(0, -a[0]) * 0.3);
    const fwd = Math.max(0, a[0]);
    return [out * (1 - fwd / 16) - sign * fwd * 0.25 * (1 - turn) + a[0] * turn, a[1] - fwd * 0.2];
  };
  const shoulderSpread = turn >= 1 ? 0 : b.torso / 2 - 0.5;
  const sF: P2 = [torsoX + lean * 0.4 + shoulderSpread * (back ? -1 : 1) * (1 - turn * 0.6) + shear * 0.5, shoulderY];
  const sB: P2 = [torsoX + lean * 0.4 - shoulderSpread * (back ? -1 : 1) * (1 - turn * 0.6) + shear * 0.5, shoulderY];
  const margin = b.limb * 0.75 + 1.5;
  const keepIn = (s: P2, a: P2): P2 => [Math.min(32 - margin, Math.max(margin, s[0] + a[0])) - s[0], Math.max(margin - s[1], a[1])];
  const aF = keepIn(sF, sideArm(pose.armF, back ? -1 : 1));
  const aB = keepIn(sB, sideArm(pose.armB, back ? 1 : -1));
  const scaleLeg = (l: P2): P2 => [l[0], l[1] * b.legs];
  const hipSpread = turn >= 1 ? 0 : 2.4;
  const lF = scaleLeg(pose.legF);
  const lB = scaleLeg(pose.legB);
  const legF: P2 = turn >= 1 ? lF : [hipSpread * (back ? -1 : 1) + lF[0] * turn, lF[1] - Math.abs(lF[0]) * 0.15];
  const legB: P2 = turn >= 1 ? lB : [-hipSpread * (back ? -1 : 1) + lB[0] * turn, lB[1] - Math.abs(lB[0]) * 0.15];
  const hipX = cx + lean * 0.3 - shear * 0.5;
  const clampFoot = (x: number): number => Math.min(31 - b.limb, Math.max(1 + b.limb, x));

  // Back limbs.
  drawLeg(pc, app, hipX + legB[0] * 0.15, hipY, clampFoot(hipX + legB[0]), hipY + legB[1], b.limb, !back && turn > 0);
  drawArm(pc, app, sB[0], sB[1], sB[0] + aB[0], sB[1] + aB[1], b.limb, turn > 0 && !back, !!pose.fist);

  // Torso: orange gi, blue undershirt at the neck, lapels, school mark, belt.
  const tw = b.torso;
  const ty = (shoulderY + hipY) / 2 + 0.2;
  pc.ellipse(torsoX + shear * 0.3, ty, tw / 2, 6.4, pal.outfit, shade(pal.outfit, 0.8));
  const giLine = shade(pal.outfitDark, 0.9);
  if (!back) {
    const nx = torsoX + turn * 2.2;
    pc.tri(nx - 2.4 + turn, shoulderY - 0.6, nx + 2.4, shoulderY - 0.6, nx + turn * 0.8, shoulderY + 4.2, pal.accent);
    pc.limb(nx - 2.6 + turn, shoulderY - 0.2, nx + 0.6 + turn, hipY - 2.2, 0.5, giLine);
    if (turn < 0.9) pc.limb(nx + 2.6, shoulderY - 0.2, nx + 0.2, shoulderY + 4.4, 0.5, giLine);
    // Turtle School mark on the chest.
    if (turn < 0.9) {
      const mx = torsoX - 2.6 + turn * 3.6;
      pc.ellipse(mx, shoulderY + 3.4, 1.4, 1.4, WHITE);
      pc.rect(mx - 0.4, shoulderY + 2.6, 0.8, 1.6, EYE);
    }
  } else {
    pc.ellipse(torsoX, ty - 0.6, 2.9, 2.9, WHITE);
    pc.rect(torsoX - 1.4, ty - 1.6, 2.8, 0.5, EYE);
    pc.rect(torsoX - 0.3, ty - 2.4, 0.6, 3.6, EYE);
    pc.rect(torsoX - 1.2, ty + 0.4, 2.4, 0.5, EYE);
  }
  pc.rect(torsoX - tw / 2 + 0.4 + shear * 0.1, hipY - 1.9, tw - 0.8, 2, pal.accent);
  if (!back) {
    const kx = torsoX + (turn >= 1 ? 3.2 : turn * 2.4);
    pc.rect(kx - 0.8, hipY - 2.1, 1.6, 2.3, shade(pal.accent, 1.2));
    pc.limb(kx - 0.3, hipY, kx - 1.2, hipY + 2.8, 0.7, pal.accent);
    pc.limb(kx + 0.3, hipY, kx + 0.9, hipY + 2.6, 0.7, pal.accent);
  }

  drawLeg(pc, app, hipX + legF[0] * 0.15, hipY, clampFoot(hipX + legF[0]), hipY + legF[1], b.limb, back);

  // Head, face and hair (hair last so spikes overlap the brow line).
  pc.ellipse(headX, headY, b.head, b.head * 1.02, pal.skin, shade(pal.skin, 0.86));
  pc.limb(headX - 1.4 + turn, headY + b.head - 0.6, headX - 1 + turn, shoulderY, 2.4, shade(pal.skin, 0.9));
  drawFace(pc, hero, app, headX, headY, pose.eyes ?? 'open', view);
  drawHair(pc, hero, app, headX, headY, b.head, view);

  drawArm(pc, app, sF[0], sF[1], sF[0] + aF[0], sF[1] + aF[1], b.limb, back && turn < 1, !!pose.fist);

  if (pose.fx) {
    const hxF = sF[0] + aF[0];
    const hyF = sF[1] + aF[1];
    let fx = hxF;
    let fy = hyF;
    if (pose.fxAt === 'between') {
      fx = (hxF + sB[0] + aB[0]) / 2 + (turn >= 1 ? 1.6 : 0);
      fy = (hyF + sB[1] + aB[1]) / 2;
    } else if (pose.fxAt === 'above') {
      fy = hyF - 3.2;
    } else if (pose.fxAt === 'face') {
      fx = headX + turn * 2;
      fy = headY;
    } else if (turn >= 1) fx += 1.8;
    drawFx(pc, app, pose.fx, Math.min(30, Math.max(2, fx)), Math.max(3, fy), pose.fxPower ?? 1);
  }
}

export function isHeroAppearance(app: AppearanceDef): app is AppearanceDef & { hero: 'goku' | 'krillin' | 'yamcha' } {
  return !!app.hero;
}

/** One atlas per hero, shared by exploration and battle (64×96 frames, 5 stored views = 8 directions). */
export function generateHeroAtlas(id: string, app: AppearanceDef & { hero: 'goku' | 'krillin' | 'yamcha' }): GeneratedAtlas {
  const views: ViewId[] = ['S', 'SE', 'E', 'NE', 'N'];
  const fw = 64;
  const fh = 96;
  const manifest = buildManifest(`${id}:hero`, fw, fh, views, HERO_ANIMS);
  const size = frameRect(manifest, 0, 0);
  const pc = new PixelCanvas(size.atlasW, size.atlasH);
  const outline = shade(app.palette.outfitDark, 0.3);
  views.forEach((view, row) => {
    for (const [anim, def] of Object.entries(HERO_ANIMS) as [keyof typeof POSES, AnimDef][]) {
      const poses = POSES[anim];
      for (let f = 0; f < def.frames; f++) {
        const r = frameRect(manifest, manifest.columns[anim]! + f, row);
        pc.setOrigin(r.x, r.y, 2);
        drawHero(pc, app.hero, app, poses[f % poses.length], view);
        pc.outline(r.x, r.y, fw, fh, outline);
      }
    }
  });
  return { manifest, width: pc.width, height: pc.height, data: pc.toTextureData() };
}

export const HERO_POSE_COUNTS: Partial<Record<AnimId, number>> = Object.fromEntries(Object.entries(POSES).map(([k, v]) => [k, v.length]));

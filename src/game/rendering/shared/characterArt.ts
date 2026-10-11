import type { AnimId } from '../../components';
import type { AppearanceDef } from '../../content/types';
import { BATTLE_ANIMS, buildManifest, type SpriteManifest, type ViewId, WORLD_ANIMS } from './manifest';
import { PixelCanvas, shade } from './PixelCanvas';

type P2 = [number, number];

/** Pose in side-view design units (32x48 space, character faces right, feet at y=46). */
interface Pose {
  bob: number;
  lean: number;
  armF: P2;
  armB: P2;
  legF: P2;
  legB: P2;
  fist?: boolean;
  glow?: boolean;
  headDy?: number;
}

const REST: Pose = { bob: 0, lean: 0, armF: [2, 10], armB: [-2, 10], legF: [1.5, 16], legB: [-1.5, 16] };
const p = (o: Partial<Pose>): Pose => ({ ...REST, ...o });

/** Every frame of every animation as poses. Counts must match the manifests. */
const POSES: Partial<Record<AnimId, Pose[]>> = {
  idle: [p({}), p({ bob: 0.6, armF: [2, 9.5], armB: [-2, 9.5] })],
  walk: [
    p({ legF: [4, 15.5], legB: [-4, 15.5], armF: [-3, 9.5], armB: [3, 9.5] }),
    p({ bob: -0.6, legF: [0.5, 15], legB: [-0.5, 16] }),
    p({ legF: [-4, 15.5], legB: [4, 15.5], armF: [3, 9.5], armB: [-3, 9.5] }),
    p({ bob: -0.6, legF: [-0.5, 16], legB: [0.5, 15] }),
  ],
  run: [
    p({ lean: 2, legF: [6, 14], legB: [-6, 13], armF: [-5, 6], armB: [5, 6] }),
    p({ lean: 2, bob: -1.2, legF: [1, 12], legB: [-2, 15] }),
    p({ lean: 2, legF: [-6, 13], legB: [6, 14], armF: [5, 6], armB: [-5, 6] }),
    p({ lean: 2, bob: -1.2, legF: [-2, 15], legB: [1, 12] }),
  ],
  jump: [p({ bob: -2, legF: [4, 11], legB: [-2, 12], armF: [4, -6], armB: [-4, -5] })],
  interact: [p({ armF: [9, 3] })],
  hit: [p({ lean: -2.5, headDy: 1, armF: [-4, 5], armB: [-6, 4], legF: [3, 15.5] })],
  defeat: [p({ bob: 7, lean: 3, headDy: 2, legF: [6, 8], legB: [5, 9], armF: [4, 10], armB: [2, 9] })],
  hover: [p({ legF: [1.5, 14.5], legB: [-1, 13.5], armF: [3, 8], armB: [-3, 8] }), p({ bob: -1, legF: [1.5, 14.5], legB: [-1, 13.5], armF: [3, 8], armB: [-3, 8] })],
  fly: [p({ lean: 5, legF: [-6, 12], legB: [-8, 10.5], armF: [9, 1], armB: [-6, 6] }), p({ lean: 5, bob: -0.6, legF: [-7, 11.5], legB: [-8.5, 10], armF: [9, 0.5], armB: [-6, 5] })],
  punch: [p({ lean: -1, armF: [-2, 5], armB: [3, 6], fist: true }), p({ lean: 2, armF: [11, 0], armB: [-3, 7], legF: [4, 15.5], fist: true }), p({ lean: 1, armF: [6, 4], armB: [-2, 8], fist: true })],
  kick: [p({ legF: [6, 9], armF: [3, 3], armB: [-4, 5] }), p({ lean: -2, legF: [12, 3], armF: [-2, 4], armB: [-6, 3] }), p({ legF: [6, 11], armF: [3, 5], armB: [-3, 6] })],
  guard: [p({ lean: -1, armF: [6, -2], armB: [5, 0], fist: true })],
  knockback: [p({ lean: -4, headDy: 1, armF: [-6, -4], armB: [-7, -2], legF: [5, 12], legB: [3, 13] })],
  dash: [p({ lean: 6, armF: [-7, 6], armB: [-8, 5], legF: [-7, 12], legB: [-8, 11] })],
  charge: [p({ armF: [4, 10], armB: [-4, 10], legF: [4, 16], legB: [-4, 16], fist: true }), p({ bob: 0.8, armF: [4.5, 10], armB: [-4.5, 10], legF: [4, 16], legB: [-4, 16], fist: true })],
  kiblast: [p({ lean: -1, armF: [-3, 8], armB: [-4, 8] }), p({ lean: 1.5, armF: [10, 2], armB: [9, 3], glow: true })],
  special: [p({ armF: [4, -10], armB: [-3, -10], glow: true }), p({ lean: 2, armF: [10, 1], armB: [9, 2], glow: true })],
  victory: [p({ armF: [2, -12], fist: true }), p({ bob: -0.8, armF: [2, -12.5], fist: true })],
};

const BUILD = {
  slim: { torso: 8, limb: 2.6, head: 5.4 },
  normal: { torso: 9.5, limb: 3, head: 5.6 },
  broad: { torso: 11.5, limb: 3.6, head: 5.6 },
  huge: { torso: 13, limb: 4.4, head: 5 },
};

const VIEW_TURN: Record<ViewId, { turn: number; back: boolean }> = {
  S: { turn: 0, back: false },
  SE: { turn: 0.5, back: false },
  E: { turn: 1, back: false },
  NE: { turn: 0.5, back: true },
  N: { turn: 0, back: true },
};

function drawHair(pc: PixelCanvas, app: AppearanceDef, hx: number, hy: number, r: number, view: ViewId): void {
  const { hair, accent, skin } = app.palette;
  const hs = shade(hair, 0.75);
  const { turn, back } = VIEW_TURN[view];
  const dir = turn; // 0 front/back, 1 profile facing right
  switch (app.hairStyle) {
    case 'spiky':
      pc.ellipse(hx - dir * 1, hy - 2, r + 0.6, r * 0.7, hair, hs);
      for (let i = -2; i <= 2; i++) pc.tri(hx + i * 2.2 - dir * 1.5 - 1.4, hy - 3, hx + i * 2.2 - dir * 1.5 + 1.4, hy - 3, hx + i * 2.6 - dir * 3, hy - r - 4 + Math.abs(i) * 0.8, hair);
      if (back) pc.ellipse(hx, hy, r + 0.4, r * 0.9, hair, hs);
      else if (turn > 0) pc.tri(hx - r, hy - 3, hx - r + 3, hy - 2, hx - r - 3, hy + 2, hair);
      break;
    case 'ponytail':
      pc.ellipse(hx - dir, hy - 2.2, r + 0.5, r * 0.65, hair, hs);
      if (back || turn > 0) pc.limb(hx - dir * 4, hy - 1, hx - dir * 7 - (back ? 0 : 1), hy + 6, 2.6, hair, hs);
      if (back) pc.ellipse(hx, hy, r + 0.3, r * 0.85, hair, hs);
      pc.rect(hx - 1 - dir * 3, hy - 2, 2, 2, accent);
      break;
    case 'bald':
      pc.ellipse(hx - 1.5, hy - 3, 1.4, 1, shade(skin, 1.15));
      break;
    case 'mohawk':
      pc.limb(hx - dir * 1, hy - r - 2, hx - dir * 1 - (turn > 0 ? 3 : 0), hy - 1, back || turn === 0 ? 2.4 : 3.2, hair, hs);
      pc.tri(hx - 1.5, hy - r + 1, hx + 1.5, hy - r + 1, hx, hy - r - 4, hair);
      break;
    case 'leaf':
      pc.ellipse(hx, hy - 2, r + 0.3, r * 0.6, hair, hs);
      pc.tri(hx - 1, hy - r, hx + 1, hy - r, hx + 3, hy - r - 6, shade(hair, 1.25));
      pc.tri(hx - 1, hy - r, hx + 1, hy - r, hx - 4, hy - r - 4, hair);
      break;
    case 'bandana':
      pc.ellipse(hx - dir, hy - 2.2, r + 0.4, r * 0.62, hair, hs);
      pc.rect(hx - r - 0.5, hy - 3, r * 2 + 1, 2, accent);
      if (turn > 0 || back) pc.limb(hx - dir * r, hy - 2, hx - dir * r - 3, hy + 2, 1.6, accent);
      break;
    case 'stone':
      pc.ellipse(hx, hy - 1, r + 1, r, hair, hs);
      pc.rect(hx - r, hy - 2, 2, 2, shade(hair, 0.6));
      pc.rect(hx + 1, hy - r + 1, 2, 1, shade(hair, 0.6));
      break;
  }
}

function drawFace(pc: PixelCanvas, app: AppearanceDef, hx: number, hy: number, view: ViewId): void {
  const { turn, back } = VIEW_TURN[view];
  if (back) return;
  const eye = app.hairStyle === 'stone' ? app.palette.accent : 0x1a1420;
  const off = turn * 2.5;
  if (turn < 1) {
    pc.rect(hx - 2.2 + off, hy, 1, 1.6, eye);
    pc.rect(hx + 1.4 + off, hy, 1, 1.6, eye);
    pc.rect(hx - 0.4 + off, hy + 2.8, 1.4, 0.6, shade(app.palette.skin, 0.65));
  } else {
    pc.rect(hx + 2.4, hy, 1, 1.6, eye);
    pc.rect(hx + 3.6, hy + 2.6, 1, 0.6, shade(app.palette.skin, 0.65));
  }
}

function drawArm(pc: PixelCanvas, app: AppearanceDef, sx: number, sy: number, hx: number, hy: number, thick: number, dark: boolean, fist: boolean): void {
  const f = dark ? 0.72 : 1;
  const sleeve = shade(app.palette.outfit, f);
  const skin = shade(app.palette.skin, f);
  const mx = (sx + hx) / 2;
  const my = (sy + hy) / 2;
  pc.limb(sx, sy, mx, my, thick + 0.4, sleeve, shade(sleeve, 0.8));
  pc.limb(mx, my, hx, hy, thick, skin, shade(skin, 0.82));
  pc.ellipse(hx, hy, fist ? thick * 0.75 : thick * 0.6, fist ? thick * 0.7 : thick * 0.55, app.hairStyle === 'stone' ? shade(app.palette.skin, f * 0.9) : skin);
}

function drawLeg(pc: PixelCanvas, app: AppearanceDef, hx: number, hy: number, fx: number, fy: number, thick: number, dark: boolean): void {
  const f = dark ? 0.72 : 1;
  const pants = shade(app.palette.outfitDark, f);
  pc.limb(hx, hy, fx, fy - 1.5, thick + 0.6, pants, shade(pants, 0.8));
  pc.ellipse(fx + 0.6, fy - 0.8, thick * 0.7, thick * 0.45, shade(app.palette.boots, f));
}

/** Draws one character frame into the canvas cell. */
export function drawCharacter(pc: PixelCanvas, app: AppearanceDef, pose: Pose, view: ViewId): void {
  const b = BUILD[app.build];
  const { turn, back } = VIEW_TURN[view];
  const pal = app.palette;
  const cx = 16;
  const bob = pose.bob;
  const lean = pose.lean * turn;
  const shoulderY = 19 + bob;
  const hipY = 30 + bob;
  const torsoX = cx + lean * 0.6;
  const headX = cx + lean + turn * 0.8;
  const headY = 11 + bob + (pose.headDy ?? 0) + (app.build === 'huge' ? 2 : 0);

  const sideArm = (a: P2, sign: number): P2 => {
    if (turn >= 1) return a;
    // Front/back views: forward reach becomes inward foreshortening, sideways spread outward.
    const out = sign * (b.torso / 2 + 1 + Math.max(0, -a[0]) * 0.3);
    const fwd = Math.max(0, a[0]);
    return [out * (1 - fwd / 16) - sign * fwd * 0.25 * (1 - turn) + a[0] * turn, a[1] - fwd * 0.2];
  };
  const shoulderSpread = turn >= 1 ? 0 : b.torso / 2 - 0.5;
  const sF: P2 = [torsoX + lean * 0.4 + shoulderSpread * (back ? -1 : 1) * (1 - turn * 0.6), shoulderY];
  const sB: P2 = [torsoX + lean * 0.4 - shoulderSpread * (back ? -1 : 1) * (1 - turn * 0.6), shoulderY];
  // Keep hands (fist radius + 1px outline) inside the 32px cell so atlas frames never bleed.
  const margin = b.limb * 0.75 + 1.5;
  const keepIn = (s: P2, a: P2): P2 => [Math.min(32 - margin, Math.max(margin, s[0] + a[0])) - s[0], a[1]];
  const aF = keepIn(sF, sideArm(pose.armF, back ? -1 : 1));
  const aB = keepIn(sB, sideArm(pose.armB, back ? 1 : -1));
  const hipSpread = turn >= 1 ? 0 : 2.2;
  const legF: P2 = turn >= 1 ? pose.legF : [hipSpread * (back ? -1 : 1), pose.legF[1] - Math.abs(pose.legF[0]) * 0.15];
  const legB: P2 = turn >= 1 ? pose.legB : [-hipSpread * (back ? -1 : 1), pose.legB[1] - Math.abs(pose.legB[0]) * 0.15];
  const hipX = cx + lean * 0.3;

  const frontLimbsDark = back;
  // Back limbs first.
  drawLeg(pc, app, hipX + legB[0] * 0.15, hipY, hipX + legB[0], hipY + legB[1], b.limb, !frontLimbsDark && turn > 0);
  drawArm(pc, app, sB[0], sB[1], sB[0] + aB[0], sB[1] + aB[1], b.limb, turn > 0 && !back, !!pose.fist);
  // Torso + belt.
  pc.ellipse(torsoX, 24.5 + bob, b.torso / 2, 6.8, pal.outfit, shade(pal.outfit, 0.78));
  if (!back) pc.tri(torsoX - 2 + turn * 2, shoulderY - 1, torsoX + 2 + turn * 2, shoulderY - 1, torsoX + turn * 2, shoulderY + 4, shade(pal.skin, 0.95));
  pc.rect(torsoX - b.torso / 2 + 0.5, hipY - 1.6, b.torso - 1, 2, pal.accent);
  drawLeg(pc, app, hipX + legF[0] * 0.15, hipY, hipX + legF[0], hipY + legF[1], b.limb, frontLimbsDark);
  // Head.
  pc.ellipse(headX, headY, b.head, b.head * 0.95, pal.skin, shade(pal.skin, 0.84));
  drawFace(pc, app, headX, headY, view);
  drawHair(pc, app, headX, headY, b.head, view);
  drawArm(pc, app, sF[0], sF[1], sF[0] + aF[0], sF[1] + aF[1], b.limb, back && turn < 1, !!pose.fist);
  if (pose.glow) {
    const gx = Math.min(28, sF[0] + aF[0] + (turn >= 1 ? 2 : 0));
    const gy = sF[1] + aF[1];
    pc.ellipse(gx, gy, 2.4, 2.4, shade(pal.aura, 1.1));
    pc.ellipse(gx, gy, 1.2, 1.2, 0xffffff);
  }
}

export interface GeneratedAtlas {
  manifest: SpriteManifest;
  width: number;
  height: number;
  /** Bottom-up RGBA rows ready for a DataTexture. */
  data: Uint8Array;
}

export function generateCharacterAtlas(id: string, app: AppearanceDef, mode: 'world' | 'battle'): GeneratedAtlas {
  const scale = mode === 'world' ? 1 : 2;
  const fw = 32 * scale;
  const fh = 48 * scale;
  const views: ViewId[] = mode === 'world' ? ['S', 'SE', 'E', 'NE', 'N'] : ['S', 'E', 'N'];
  const manifest = buildManifest(`${id}:${mode}`, fw, fh, views, mode === 'world' ? WORLD_ANIMS : BATTLE_ANIMS);
  const pc = new PixelCanvas(manifest.totalColumns * fw, views.length * fh);
  const outlineColor = shade(app.palette.outfitDark, 0.35);
  views.forEach((view, row) => {
    for (const [anim, def] of Object.entries(manifest.anims) as [AnimId, { frames: number }][]) {
      const poses = POSES[anim] ?? POSES.idle!;
      for (let f = 0; f < def.frames; f++) {
        const col = manifest.columns[anim]! + f;
        pc.setOrigin(col * fw, row * fh, scale);
        drawCharacter(pc, app, poses[f % poses.length], view);
        pc.outline(col * fw, row * fh, fw, fh, outlineColor);
      }
    }
  });
  return { manifest, width: pc.width, height: pc.height, data: pc.toTextureData() };
}

export const POSE_FRAME_COUNTS: Partial<Record<AnimId, number>> = Object.fromEntries(Object.entries(POSES).map(([k, v]) => [k, v!.length]));

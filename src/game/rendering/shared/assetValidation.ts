import type { AnimId } from '../../components';
import { BATTLE_ANIMS, type SpriteManifest, WORLD_ANIMS } from './manifest';

export interface AtlasImage {
  width: number;
  height: number;
  /** RGBA, rows top-down (PNG order). */
  rgba: Uint8Array;
}

export interface AssetIssue {
  severity: 'error' | 'warning';
  message: string;
}

export const ATLAS_NAME = /^(char|enemy|npc)_[a-z0-9]+(?:_[a-z0-9]+)*_(world|battle)$/;
export const FRAME_SIZE = { world: { w: 32, h: 48 }, battle: { w: 64, h: 96 } } as const;

/** Converts bottom-up DataTexture rows to top-down PNG rows. */
export function toTopDown(width: number, height: number, bottomUp: Uint8Array): Uint8Array {
  const out = new Uint8Array(bottomUp.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) out.set(bottomUp.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return out;
}

interface FrameBox {
  opaque: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function frameBox(img: AtlasImage, x0: number, y0: number, w: number, h: number): FrameBox {
  const b: FrameBox = { opaque: 0, minX: w, maxX: -1, minY: h, maxY: -1 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = img.rgba[((y0 + y) * img.width + x0 + x) * 4 + 3];
      if (a === 0) continue;
      b.opaque++;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }
  return b;
}

/**
 * Validates a character sprite atlas against its manifest: naming, frame
 * size per mode, atlas dimensions, required animations/frame counts,
 * transparency, empty frames, edge bleeding, pivot alignment and size
 * consistency between frames of the same animation.
 */
export function validateAtlas(name: string, manifest: SpriteManifest, img: AtlasImage): AssetIssue[] {
  const issues: AssetIssue[] = [];
  const err = (message: string): void => void issues.push({ severity: 'error', message });
  const warn = (message: string): void => void issues.push({ severity: 'warning', message });

  const m = ATLAS_NAME.exec(name);
  if (!m) err(`nombre "${name}" no sigue <char|enemy|npc>_<id>_<world|battle>`);
  const mode = (m?.[2] ?? (manifest.frameWidth > 32 ? 'battle' : 'world')) as 'world' | 'battle';
  const want = FRAME_SIZE[mode];
  if (manifest.frameWidth !== want.w || manifest.frameHeight !== want.h) err(`frame ${manifest.frameWidth}x${manifest.frameHeight}, se esperaba ${want.w}x${want.h} para ${mode}`);

  const ew = manifest.totalColumns * manifest.frameWidth;
  const eh = manifest.views.length * manifest.frameHeight;
  if (img.width !== ew || img.height !== eh) {
    err(`atlas ${img.width}x${img.height}, el manifiesto implica ${ew}x${eh}`);
    return issues;
  }

  const required = mode === 'world' ? WORLD_ANIMS : BATTLE_ANIMS;
  let col = 0;
  for (const [anim, def] of Object.entries(required) as [AnimId, { frames: number }][]) {
    const got = manifest.anims[anim];
    if (!got) err(`falta la animación "${anim}"`);
    else if (got.frames !== def.frames) warn(`"${anim}" tiene ${got.frames} frames (referencia ${def.frames})`);
    if (got && manifest.columns[anim] !== col) err(`columna de "${anim}" = ${manifest.columns[anim]}, se esperaba ${col}`);
    col += got?.frames ?? 0;
  }
  if (mode === 'world' && manifest.views.length < 5) warn('los sprites de mundo deberían tener 5 vistas (8 direcciones con espejo)');

  const fw = manifest.frameWidth;
  const fh = manifest.frameHeight;
  let transparent = 0;
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] === 0) transparent++;
  if (transparent === 0) err('el atlas no tiene transparencia');

  const edgeFrames: string[] = [];
  const groundAnims: AnimId[] = mode === 'world' ? ['idle', 'walk', 'run', 'interact', 'hit'] : [];
  manifest.views.forEach((view, row) => {
    for (const [anim, def] of Object.entries(manifest.anims) as [AnimId, { frames: number }][]) {
      const heights: number[] = [];
      for (let f = 0; f < def.frames; f++) {
        const c = (manifest.columns[anim] ?? 0) + f;
        const b = frameBox(img, c * fw, row * fh, fw, fh);
        const where = `${anim}[${f}] vista ${view}`;
        if (b.opaque === 0) {
          err(`${where}: frame vacío`);
          continue;
        }
        if (b.minX === 0 || b.maxX === fw - 1) edgeFrames.push(`${anim}[${f}]/${view}`);
        if (groundAnims.includes(anim) && Math.abs(b.maxY - manifest.pivot.y) > 3) warn(`${where}: los pies (y=${b.maxY}) no están alineados con el pivote (y=${manifest.pivot.y})`);
        heights.push(b.maxY - b.minY + 1);
      }
      if (heights.length > 1) {
        const lo = Math.min(...heights);
        const hi = Math.max(...heights);
        if (hi > lo * 1.35) warn(`${anim} vista ${view}: altura inconsistente entre frames (${lo}..${hi}px)`);
      }
    }
  });
  if (edgeFrames.length) warn(`${edgeFrames.length} frames tocan el borde lateral (riesgo de sangrado con filtrado lineal): ${edgeFrames.slice(0, 6).join(', ')}${edgeFrames.length > 6 ? '…' : ''}`);
  return issues;
}

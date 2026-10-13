// Slices the hand-painted Goku sheets in assets/generated/sprites/Nuevos/Goku
// into the hero atlas (64×96, feet on the shared pivot, one scale for every frame).
//   npx tsx scripts/build-goku-atlas.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { HERO_ANIMS } from '../src/game/rendering/shared/heroArt';
import { buildManifest, frameRect, type SpriteManifest, type ViewId } from '../src/game/rendering/shared/manifest';

const SHEET_DIR = resolve('assets/generated/sprites/Nuevos/Goku');
const VIEWS: ViewId[] = ['S', 'SE', 'E', 'NE', 'N'];

/** Content rows, top to bottom. null = drawn, but not used (a duplicate walk). */
const SHEETS: { file: string; rows: (string | null)[] }[] = [
  { file: 'goku_01.png', rows: ['idle', 'idle', 'idle', 'idle', 'jump'] },
  { file: 'goku_02.png', rows: ['idle_wait', 'idle_wait', 'idle_wait', 'idle_wait', 'interact'] },
  { file: 'goku_03.png', rows: [null, null, null, 'dash'] },
  { file: 'goku_04_A.png', rows: ['walk', 'walk', 'walk', null] },
  { file: 'goku_04_B.png', rows: ['run', 'run', 'run', 'run', 'guard'] },
  { file: 'goku_05.png', rows: ['punch', 'punch', 'punch', 'dodge', 'dodge'] },
  { file: 'goku_06.png', rows: ['kick', 'kick', 'kick', 'pickup', 'pickup'] },
  { file: 'goku_07.png', rows: ['stance', 'stance', 'hover', 'hover', 'hit'] },
  { file: 'goku_08.png', rows: ['fly', 'fly', 'charge', 'charge', 'knockback'] },
  { file: 'goku_09.png', rows: ['kiblast', 'kiblast', 'confused', 'confused', 'fall'] },
  { file: 'goku_10.png', rows: ['victory', 'victory', 'special', 'special', 'defeat'] },
  { file: 'goku_11.png', rows: ['tech_kamehameha', 'tech_kamehameha', 'tech_kamehameha', 'tech_kaioken', 'tech_kaioken'] },
  { file: 'goku_13.png', rows: ['tech_teleport', 'tech_teleport', 'tech_teleport'] },
  { file: 'goku_12.png', rows: ['tech_barrage', 'tech_barrage', 'tech_barrage'] },
];

/** Techniques Goku never plays. Copied from the closest painted pose so the shared atlas stays valid. */
const COPIES: Record<string, string> = {
  tech_kienzan: 'kiblast',
  tech_taiyoken: 'special',
  tech_sokidan: 'kiblast',
  tech_wolf_fang: 'punch',
};

interface Crop {
  anim: string;
  frame: number;
  view: number;
  png: PNG;
  bg: Uint8Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Empty source pixels between the sprite bottom and the sheet's standing ground line. */
  lift: number;
  flip: boolean;
  /** Source pixels to one destination pixel. Shared by every frame of this sheet so the body stays one size. */
  scale: number;
  /** Pixels of a neighbouring frame that crossed into this cell. */
  reject: Set<number>;
}

/**
 * The sheets already have a real alpha channel. The backdrop is transparent
 * (alpha near 0). The hair is opaque black, so it must not be keyed by color.
 */
function maskBackground(png: PNG): Uint8Array {
  const bg = new Uint8Array(png.width * png.height);
  const d = png.data;
  for (let i = 0; i < bg.length; i++) if (d[i * 4 + 3]! < 24) bg[i] = 1;
  return bg;
}

function bands(ink: number[], minRun: number, expected: number, close: number): [number, number][] {
  const marks = ink.map((v) => v > 12);
  for (let i = 0; i < marks.length; i++) {
    if (marks[i]) continue;
    let j = i;
    while (j < marks.length && !marks[j]) j++;
    if (i > 0 && j < marks.length && j - i <= close) {
      for (let k = i; k < j; k++) marks[k] = true;
    }
    i = j;
  }
  const spans: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= marks.length; i++) {
    if (i < marks.length && marks[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minRun) spans.push([start, i]);
      start = -1;
    }
  }
  // Drop tiny noise bands. Never merge two real rows: that would cut a pose in half.
  while (spans.length > expected) {
    let shortest = 0;
    for (let i = 1; i < spans.length; i++) {
      if (spans[i]![1] - spans[i]![0] < spans[shortest]![1] - spans[shortest]![0]) shortest = i;
    }
    const span = spans[shortest]!;
    if (span[1] - span[0] > ink.length / (expected * 3)) break;
    spans.splice(shortest, 1);
  }
  return spans;
}

function inkProjection(bg: Uint8Array, w: number, h: number, axis: 'x' | 'y'): number[] {
  const n = axis === 'x' ? w : h;
  const ink = new Array<number>(n).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bg[y * w + x]) continue;
      ink[axis === 'x' ? x : y]!++;
    }
  }
  return ink;
}

function tightBox(png: PNG, bg: Uint8Array, reject: Set<number>, x0: number, y0: number, x1: number, y1: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const w = png.width;
  let minX = x1;
  let minY = y1;
  let maxX = x0 - 1;
  let maxY = y0 - 1;
  const d = png.data;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * w + x;
      if (bg[p] || reject.has(p)) continue;
      const o = p * 4;
      const a = d[o + 3]!;
      if (a < 18) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  // Drop a ground shadow: walk up while the bottom row is only dark, non-blue pixels.
  while (maxY > minY) {
    let keep = false;
    for (let x = minX; x <= maxX; x++) {
      const p = maxY * w + x;
      if (bg[p] || reject.has(p)) continue;
      const o = p * 4;
      const r = d[o]!;
      const g = d[o + 1]!;
      const b = d[o + 2]!;
      const a = d[o + 3]!;
      if (a < 18) continue;
      const boot = b > 70 && b > r + 12 && b > g;
      const colored = Math.max(r, g, b) > 80;
      if (boot || colored) {
        keep = true;
        break;
      }
    }
    if (keep) break;
    maxY--;
  }
  return { minX, minY, maxX, maxY };
}

function equalSpans(length: number, count: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) out.push([Math.round((i * length) / count), Math.round(((i + 1) * length) / count)]);
  return out;
}

/** Split a band that covers several stacked poses (raised arms bridge the gap). */
function projectionRect(bg: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number, axis: 'x' | 'y'): number[] {
  const n = axis === 'x' ? x1 : y1;
  const ink = new Array<number>(n).fill(0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (bg[y * w + x]) continue;
      ink[axis === 'x' ? x : y]!++;
    }
  }
  return ink;
}

/** Cut where the two poses overlap the least, instead of through the middle of a body. */
function valleyCut(ink: number[], a: number, b: number): number {
  const margin = Math.max(8, Math.floor((b - a) * 0.18));
  const lo = a + margin;
  const hi = b - margin;
  let cut = Math.round((a + b) / 2);
  let best = Number.POSITIVE_INFINITY;
  for (let i = lo; i < hi; i++) {
    const v = ink[i] ?? 0;
    if (v < best) {
      best = v;
      cut = i;
    }
  }
  return cut;
}

function splitTall(spans: [number, number][], ink: number[], target: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of spans) {
    const n = Math.max(1, Math.round((b - a) / target));
    if (n <= 1) {
      out.push([a, b]);
      continue;
    }
    const cuts = [a];
    for (let i = 1; i < n; i++) {
      const guess = Math.round(a + ((b - a) * i) / n);
      const window = Math.round((b - a) / n);
      const prev = cuts[cuts.length - 1]!;
      const cut = valleyCut(ink, Math.max(prev, guess - window), Math.min(b, guess + window));
      cuts.push(Math.max(prev + 1, Math.min(b - (n - i), cut)));
    }
    cuts.push(b);
    for (let i = 0; i < cuts.length - 1; i++) out.push([cuts[i]!, cuts[i + 1]!]);
  }
  return out;
}

/**
 * Columns of one row. Wide flying poses overlap in the sheet projection, so the
 * standing-sheet grid slices a fist or a boot from the next frame into this cell.
 */
function columnsForRow(bg: Uint8Array, w: number, y0: number, y1: number, fallback: [number, number][] | undefined): [number, number][] {
  const ink = projectionRect(bg, w, 0, y0, w, y1, 'x');
  let spans = bands(ink, 16, 5, 3);
  if (!spans.length) spans = [[0, w]];
  let guard = 0;
  while (spans.length < 5 && guard++ < 6) {
    let widest = 0;
    for (let i = 1; i < spans.length; i++) {
      if (spans[i]![1] - spans[i]![0] > spans[widest]![1] - spans[widest]![0]) widest = i;
    }
    const span = spans[widest]!;
    if (span[1] - span[0] < (w / 5) * 1.35) break;
    const cut = valleyCut(ink, span[0], span[1]);
    if (cut <= span[0] + 8 || cut >= span[1] - 8) break;
    spans.splice(widest, 1, [span[0], cut], [cut, span[1]]);
  }
  if (spans.length === 5) return spans;
  return fallback ?? equalSpans(w, 5);
}

/** Drops a piece of the neighbouring frame that crossed the cell edge. */
function neighborReject(bg: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number): Set<number> {
  const reject = new Set<number>();
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw <= 0 || ch <= 0) return reject;
  const seen = new Uint8Array(cw * ch);
  const comps: { pixels: number[]; touches: boolean }[] = [];
  const stack: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const local = (y - y0) * cw + (x - x0);
      const p = y * w + x;
      if (bg[p] || seen[local]) continue;
      const pixels: number[] = [];
      let touches = false;
      seen[local] = 1;
      stack.push(p);
      while (stack.length) {
        const q = stack.pop()!;
        pixels.push(q);
        const qx = q % w;
        const qy = (q / w) | 0;
        if (qx <= x0 + 1 || qx >= x1 - 2 || qy <= y0 + 1 || qy >= y1 - 2) touches = true;
        const next: [number, number][] = [
          [qx + 1, qy],
          [qx - 1, qy],
          [qx, qy + 1],
          [qx, qy - 1],
        ];
        for (const [nx, ny] of next) {
          if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue;
          const nl = (ny - y0) * cw + (nx - x0);
          const np = ny * w + nx;
          if (bg[np] || seen[nl]) continue;
          seen[nl] = 1;
          stack.push(np);
        }
      }
      comps.push({ pixels, touches });
    }
  }
  if (comps.length <= 1) return reject;
  let largest = 0;
  for (const c of comps) if (c.pixels.length > largest) largest = c.pixels.length;
  for (const c of comps) {
    if (c.pixels.length >= largest * 0.55) continue;
    if (c.touches) for (const p of c.pixels) reject.add(p);
  }
  return reject;
}

function sliceSheet(dir: string, file: string, rowMap: (string | null)[], columnGrid: Map<number, [number, number][]>): { crops: Crop[]; note: string } {
  const png = PNG.sync.read(readFileSync(join(dir, file)));
  const bg = maskBackground(png);
  const detectedCols = bands(inkProjection(bg, png.width, png.height, 'x'), 20, 5, 10);
  if (detectedCols.length === 5 && !columnGrid.has(png.width)) columnGrid.set(png.width, detectedCols);
  const yInk = inkProjection(bg, png.width, png.height, 'y');
  const designedRows = png.height > png.width ? 5 : rowMap.length;
  let rowSpans = splitTall(bands(yInk, 24, designedRows + 2, 4), yInk, png.height / designedRows);
  if (rowSpans.length !== rowMap.length) rowSpans = equalSpans(png.height, rowMap.length);
  const note = `${file} ${png.width}x${png.height} cols=${detectedCols.length} rows=${rowSpans.length} [${rowSpans.map((s) => `${s[0]}-${s[1]}`).join(' ')}]`;
  if (rowSpans.length < 1) console.warn(`  rejilla inesperada: ${note}`);
  const rows = Math.min(rowSpans.length, rowMap.length);
  const standingBottoms: number[] = [];
  const cells: { anim: string; frame: number; view: number; box: NonNullable<ReturnType<typeof tightBox>>; reject: Set<number> }[] = [];
  const frameOf: Record<string, number> = {};
  for (let row = 0; row < rows; row++) {
    const anim = rowMap[row];
    const span = rowSpans[row];
    if (!span) break;
    const frame = anim ? (frameOf[anim] ?? 0) : 0;
    if (anim) frameOf[anim] = frame + 1;
    const colSpans = columnsForRow(bg, png.width, span[0], span[1], columnGrid.get(png.width));
    for (let col = 0; col < Math.min(5, colSpans.length); col++) {
      const cspan = colSpans[col];
      if (!cspan) continue;
      const reject = neighborReject(bg, png.width, cspan[0], span[0], cspan[1], span[1]);
      const box = tightBox(png, bg, reject, cspan[0], span[0], cspan[1], span[1]);
      if (!box) continue;
      if (row === 0) standingBottoms.push(box.maxY);
      if (!anim) continue;
      cells.push({ anim, frame, view: col, box, reject });
    }
  }
  standingBottoms.sort((a, b) => a - b);
  const ground = standingBottoms[Math.floor(standingBottoms.length / 2)] ?? 0;
  const heights = cells.filter((c) => c.view === 0).map((c) => c.box.maxY - c.box.minY + 1).sort((a, b) => a - b);
  const upper = heights.slice(Math.floor(heights.length / 2));
  const standing = upper[Math.floor(upper.length / 2)] ?? heights[heights.length - 1] ?? 240;
  const scale = 80 / standing;
  const crops: Crop[] = cells.map((c) => ({
    anim: c.anim,
    frame: c.frame,
    view: c.view,
    png,
    bg,
    ...c.box,
    lift: ground - c.box.maxY,
    flip: false,
    scale,
    reject: c.reject,
  }));
  console.log(note);
  return { crops, note };
}

function blitCrop(atlas: Uint8Array, atlasW: number, destX: number, destY: number, fw: number, fh: number, crop: Crop): void {
  let scale = crop.scale;
  const sw = crop.maxX - crop.minX + 1;
  const sh = crop.maxY - crop.minY + 1;
  let dw = Math.max(1, Math.round(sw * scale));
  let dh = Math.max(1, Math.round(sh * scale));
  // A horizontal pose (fly, kick) can be wider than the cell. Shrink that frame so the fists stay inside.
  if (dw > fw - 2) {
    scale = (fw - 2) / sw;
    dw = fw - 2;
    dh = Math.max(1, Math.round(sh * scale));
  }
  let top = 94 - dh + 1;
  if (top < 1) top = 1;
  const left = destX + Math.round((fw - dw) / 2);
  const flip = crop.flip;
  const d = crop.png.data;
  const swidth = crop.png.width;
  for (let y = 0; y < dh; y++) {
    const dy = destY + top + y;
    if (dy < destY || dy >= destY + fh) continue;
    const sy = crop.minY + Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const dx = left + x;
      if (dx < destX || dx >= destX + fw) continue;
      const sx0 = crop.minX + Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
      const sx = flip ? crop.maxX - (sx0 - crop.minX) : sx0;
      const p = sy * swidth + sx;
      if (crop.bg[p] || crop.reject.has(p)) continue;
      const o = p * 4;
      const a = d[o + 3]!;
      if (a < 24) continue;
      const t = (dy * atlasW + dx) * 4;
      atlas[t] = d[o]!;
      atlas[t + 1] = d[o + 1]!;
      atlas[t + 2] = d[o + 2]!;
      // Interior (pelo incluido) opaco. El borde suave conserva su alfa.
      atlas[t + 3] = a >= 200 ? 255 : a;
    }
  }
}

function snapFeet(atlas: Uint8Array, atlasW: number, x0: number, y0: number, fw: number, fh: number, pivotY: number): void {
  let maxY = -1;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      if (atlas[((y0 + y) * atlasW + x0 + x) * 4 + 3]! > 16) maxY = y;
    }
  }
  if (maxY < 0) return;
  const shift = pivotY - maxY;
  if (shift === 0 || Math.abs(shift) > 8) return;
  const copy = atlas.slice((y0 * atlasW + x0) * 4, ((y0 + fh) * atlasW) * 4);
  // Clear the frame, then rewrite shifted. copy is the whole width rows — do it pixel by pixel into a frame buffer.
  const frame = new Uint8Array(fw * fh * 4);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const s = ((y0 + y) * atlasW + x0 + x) * 4;
      const d = (y * fw + x) * 4;
      frame[d] = atlas[s]!;
      frame[d + 1] = atlas[s + 1]!;
      frame[d + 2] = atlas[s + 2]!;
      frame[d + 3] = atlas[s + 3]!;
      atlas[s] = atlas[s + 1] = atlas[s + 2] = atlas[s + 3] = 0;
    }
  }
  void copy;
  for (let y = 0; y < fh; y++) {
    const ny = y + shift;
    if (ny < 0 || ny >= fh) continue;
    for (let x = 0; x < fw; x++) {
      const s = (y * fw + x) * 4;
      if (frame[s + 3]! === 0) continue;
      const d = ((y0 + ny) * atlasW + x0 + x) * 4;
      atlas[d] = frame[s]!;
      atlas[d + 1] = frame[s + 1]!;
      atlas[d + 2] = frame[s + 2]!;
      atlas[d + 3] = frame[s + 3]!;
    }
  }
}

export interface PaintedSheets {
  id: string;
  dir: string;
  sheets: { file: string; rows: (string | null)[] }[];
  copies: Record<string, string>;
}

/** Repeats the last painted frame when a sheet has fewer steps than the atlas. */
function fillShortAnims(crops: Crop[]): void {
  const grouped = new Map<string, Crop[]>();
  for (const c of crops) {
    const list = grouped.get(c.anim) ?? [];
    list.push(c);
    grouped.set(c.anim, list);
  }
  for (const [anim, list] of grouped) {
    const need = HERO_ANIMS[anim as keyof typeof HERO_ANIMS]?.frames ?? 0;
    const frames = [...new Set(list.map((c) => c.frame))].sort((a, b) => a - b);
    for (let f = 0; f < need; f++) {
      if (frames.includes(f)) continue;
      const use = [...frames].reverse().find((n) => n < f) ?? frames[0];
      if (use == null) continue;
      for (const c of list.filter((c) => c.frame === use)) crops.push({ ...c, frame: f });
    }
  }
}

export function buildPaintedAtlas(hero: PaintedSheets): { width: number; height: number; rgba: Uint8Array; manifest: SpriteManifest } | null {
  if (!existsSync(hero.dir)) return null;
  const columnGrid = new Map<number, [number, number][]>();
  const crops: Crop[] = [];
  for (const sheet of hero.sheets) {
    if (!existsSync(join(hero.dir, sheet.file))) {
      console.warn(`falta ${sheet.file}`);
      continue;
    }
    crops.push(...sliceSheet(hero.dir, sheet.file, sheet.rows, columnGrid).crops);
  }
  // The walk sheet has three steps; the fourth frame repeats the passing pose so the cycle stays even.
  if (!crops.some((c) => c.anim === 'walk' && c.frame === 3)) {
    for (const c of crops.filter((c) => c.anim === 'walk' && c.frame === 1)) crops.push({ ...c, frame: 3 });
  }
  if (!crops.some((c) => c.anim === 'run' && c.frame === 3)) {
    for (const c of crops.filter((c) => c.anim === 'run' && c.frame === 1)) crops.push({ ...c, frame: 3 });
  }
  for (const [dest, src] of Object.entries(hero.copies)) {
    const source = crops.filter((c) => c.anim === src);
    const frames = HERO_ANIMS[dest as keyof typeof HERO_ANIMS]?.frames ?? 0;
    const srcFrames = new Set(source.filter((c) => c.view === 0).map((c) => c.frame));
    const srcCount = srcFrames.size;
    if (!srcCount) continue;
    for (let f = 0; f < frames; f++) {
      const use = f % srcCount;
      for (const c of source.filter((c) => c.frame === [...srcFrames][use])) {
        crops.push({ ...c, anim: dest, frame: f });
      }
    }
  }
  fillShortAnims(crops);

  const idle = crops.find((c) => c.anim === 'idle' && c.frame === 0 && c.view === 0);
  if (!idle) return null;
  console.log(`idle destino ${Math.round((idle.maxY - idle.minY + 1) * idle.scale)}px`);

  const manifest = buildManifest(hero.id, 64, 96, VIEWS, HERO_ANIMS);
  const size = frameRect(manifest, 0, 0);
  const atlas = new Uint8Array(size.atlasW * size.atlasH * 4);
  const seen = new Set<string>();
  for (const c of crops) {
    const def = HERO_ANIMS[c.anim as keyof typeof HERO_ANIMS];
    if (!def || c.frame >= def.frames || c.view >= VIEWS.length) continue;
    const key = `${c.anim}:${c.frame}:${c.view}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const col = (manifest.columns[c.anim as keyof typeof manifest.columns] ?? 0) + c.frame;
    const rect = frameRect(manifest, col, c.view);
    blitCrop(atlas, size.atlasW, rect.x, rect.y, 64, 96, c);
  }
  const ground: string[] = ['idle', 'walk', 'run', 'interact', 'hit'];
  for (const anim of ground) {
    const def = HERO_ANIMS[anim as keyof typeof HERO_ANIMS];
    if (!def) continue;
    for (let f = 0; f < def.frames; f++) {
      for (let v = 0; v < VIEWS.length; v++) {
        const col = (manifest.columns[anim as keyof typeof manifest.columns] ?? 0) + f;
        const rect = frameRect(manifest, col, v);
        snapFeet(atlas, size.atlasW, rect.x, rect.y, 64, 96, manifest.pivot.y);
      }
    }
  }

  const missing: string[] = [];
  for (const [anim, def] of Object.entries(HERO_ANIMS)) {
    for (let f = 0; f < def!.frames; f++) {
      for (let v = 0; v < VIEWS.length; v++) {
        if (!seen.has(`${anim}:${f}:${v}`)) missing.push(`${anim}[${f}]/${VIEWS[v]}`);
      }
    }
  }
  if (missing.length) console.warn(`frames sin arte (${missing.length}): ${missing.slice(0, 12).join(', ')}`);
  return { width: size.atlasW, height: size.atlasH, rgba: atlas, manifest };
}

export function buildGokuAtlas(): { width: number; height: number; rgba: Uint8Array; manifest: SpriteManifest } | null {
  return buildPaintedAtlas({ id: 'char:kaien:hero', dir: SHEET_DIR, sheets: SHEETS, copies: COPIES });
}

function paintFrame(src: Uint8Array, srcW: number, rect: { x: number; y: number }, dest: PNG, dx: number, dy: number, fw: number, fh: number, magenta: boolean): void {
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const s = ((rect.y + y) * srcW + rect.x + x) * 4;
      const d = ((dy + y) * dest.width + dx + x) * 4;
      const a = src[s + 3] ?? 0;
      if (magenta) {
        const k = a / 255;
        dest.data[d] = Math.round((src[s] ?? 0) * k + 255 * (1 - k));
        dest.data[d + 1] = Math.round((src[s + 1] ?? 0) * k);
        dest.data[d + 2] = Math.round((src[s + 2] ?? 0) * k + 255 * (1 - k));
        dest.data[d + 3] = 255;
      } else {
        dest.data[d] = a ? src[s]! : 40;
        dest.data[d + 1] = a ? src[s + 1]! : 24;
        dest.data[d + 2] = a ? src[s + 2]! : 48;
        dest.data[d + 3] = 255;
      }
    }
  }
}

export function writePreview(built: { width: number; height: number; rgba: Uint8Array; manifest: SpriteManifest }, name: string): void {
  const outDir = resolve('smoke-output');
  mkdirSync(outDir, { recursive: true });
  const fw = 64;
  const fh = 96;
  const anims = Object.keys(HERO_ANIMS);
  const cols = 5;
  const png = new PNG({ width: cols * fw, height: anims.length * fh });
  for (let i = 0; i < anims.length; i++) {
    const anim = anims[i]!;
    const def = HERO_ANIMS[anim as keyof typeof HERO_ANIMS]!;
    for (let f = 0; f < Math.min(def.frames, cols); f++) {
      const col = (built.manifest.columns[anim as keyof typeof built.manifest.columns] ?? 0) + f;
      const rect = frameRect(built.manifest, col, 0);
      paintFrame(built.rgba, built.width, rect, png, f * fw, i * fh, fw, fh, false);
    }
  }
  writeFileSync(join(outDir, `${name}-anims-s.png`), PNG.sync.write(png));
  const shown = ['idle', 'walk', 'run', 'fly', 'kick', 'dash', 'knockback', 'tech_kamehameha'];
  const views = new PNG({ width: 5 * fw, height: shown.length * fh });
  for (let i = 0; i < shown.length; i++) {
    const anim = shown[i]!;
    for (let v = 0; v < 5; v++) {
      const col = built.manifest.columns[anim as keyof typeof built.manifest.columns] ?? 0;
      const rect = frameRect(built.manifest, col, v);
      paintFrame(built.rgba, built.width, rect, views, v * fw, i * fh, fw, fh, true);
    }
  }
  writeFileSync(join(outDir, `${name}-views.png`), PNG.sync.write(views));
  const wide = ['fly', 'kick', 'dash', 'knockback', 'tech_barrage'];
  const poses = new PNG({ width: 5 * fw, height: wide.length * 2 * fh });
  for (let i = 0; i < wide.length; i++) {
    const anim = wide[i]!;
    const base = built.manifest.columns[anim as keyof typeof built.manifest.columns] ?? 0;
    for (let f = 0; f < 2; f++) {
      for (let v = 0; v < 5; v++) {
        const rect = frameRect(built.manifest, base + f, v);
        paintFrame(built.rgba, built.width, rect, poses, v * fw, (i * 2 + f) * fh, fw, fh, true);
      }
    }
  }
  writeFileSync(join(outDir, `${name}-wide.png`), PNG.sync.write(poses));
  console.log(`preview ${join(outDir, `${name}-anims-s.png`)}`);
}

function writeAtlas(outPng: string, outJson: string): void {
  const built = buildGokuAtlas();
  if (!built) throw new Error('No se pudo construir el atlas de Goku');
  const png = new PNG({ width: built.width, height: built.height });
  png.data = Buffer.from(built.rgba);
  mkdirSync(dirname(outPng), { recursive: true });
  writeFileSync(outPng, PNG.sync.write(png));
  writeFileSync(outJson, JSON.stringify(built.manifest, null, 2));
  writePreview(built, 'goku');
  console.log(`atlas ${built.width}x${built.height} -> ${outPng}`);
}

const invoked = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/build-goku-atlas.ts');
if (invoked) {
  writeAtlas(resolve('assets/generated/sprites/char_kaien_hero.png'), resolve('assets/generated/sprites/char_kaien_hero.json'));
}

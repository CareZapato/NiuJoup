import { hash2, PixelCanvas, shade } from './PixelCanvas';

export interface Tex {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Valley biome palette. Other biomes swap this table. */
export const VALLEY_PALETTE = {
  grass: 0x5aa83c,
  grassDark: 0x3f8a2e,
  grassLight: 0x78c450,
  flower1: 0xf2e35a,
  flower2: 0xf28aa8,
  path: 0xc8a46a,
  pathDark: 0xa8844a,
  sand: 0xe0c88a,
  sandDark: 0xc8ac6a,
  plank: 0x9a6a3a,
  plankDark: 0x6a4422,
  rock: 0x9a9aa6,
  rockDark: 0x6a6a78,
  cliff: 0xa88a6a,
  cliffDark: 0x7a5e44,
  wall: 0xe8dcc0,
  wallDark: 0xb8a888,
  roof: 0xc84a3a,
  roofDark: 0x8a2a22,
  fence: 0xb88a4a,
  water: 0x3a8ad8,
  waterLight: 0x8ac8f2,
  leaf: 0x3a8a3a,
  leafLight: 0x5ab04a,
  leafDark: 0x226a2a,
  trunk: 0x7a4a2a,
  sky: 0x9ad0f2,
};

export const TILE_PX = 16;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;

export const TILE_INDEX = {
  grass: [0, 1, 2, 3],
  flowers: 4,
  path: [5, 6],
  sand: 7,
  bridge: 8,
  rockTop: 9,
  rockSide: 10,
  cliffTop: 11,
  cliffSide: 12,
  plateauTop: 13,
  plateauSide: 14,
  stairsTop: 15,
  stairsSide: 16,
  houseWall: 17,
  roof: 18,
  fenceTop: 19,
  fenceSide: 20,
  forestFloor: 22,
} as const;

function noiseFill(pc: PixelCanvas, x0: number, y0: number, base: number, dark: number, light: number, seed: number, density = 0.18): void {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const h = hash2(x + seed * 31, y + seed * 17);
      pc.px(x0 + x, y0 + y, h < density ? dark : h > 1 - density * 0.6 ? light : base);
    }
  }
}

export function generateTerrainAtlas(pal = VALLEY_PALETTE): Tex {
  const pc = new PixelCanvas(ATLAS_COLS * TILE_PX, ATLAS_ROWS * TILE_PX);
  const at = (i: number): [number, number] => [(i % ATLAS_COLS) * TILE_PX, Math.floor(i / ATLAS_COLS) * TILE_PX];
  TILE_INDEX.grass.forEach((idx, v) => {
    const [x, y] = at(idx);
    noiseFill(pc, x, y, pal.grass, pal.grassDark, pal.grassLight, v + 1);
    for (let k = 0; k < 3; k++) {
      const gx = x + Math.floor(hash2(v, k) * 13) + 1;
      const gy = y + Math.floor(hash2(k, v + 9) * 12) + 2;
      pc.px(gx, gy, pal.grassDark);
      pc.px(gx + 1, gy - 1, pal.grassDark);
      pc.px(gx + 2, gy, pal.grassDark);
    }
  });
  {
    const [x, y] = at(TILE_INDEX.flowers);
    noiseFill(pc, x, y, pal.grass, pal.grassDark, pal.grassLight, 7);
    for (let k = 0; k < 6; k++) {
      const fx = x + 1 + Math.floor(hash2(k, 3) * 13);
      const fy = y + 1 + Math.floor(hash2(3, k) * 13);
      const c = k % 2 ? pal.flower1 : pal.flower2;
      pc.px(fx, fy, c);
      pc.px(fx + 1, fy, c);
      pc.px(fx, fy + 1, c);
      pc.px(fx + 1, fy + 1, 0xffffff);
    }
  }
  TILE_INDEX.path.forEach((idx, v) => {
    const [x, y] = at(idx);
    noiseFill(pc, x, y, pal.path, pal.pathDark, shade(pal.path, 1.12), v + 20, 0.22);
  });
  {
    const [x, y] = at(TILE_INDEX.sand);
    noiseFill(pc, x, y, pal.sand, pal.sandDark, shade(pal.sand, 1.08), 30, 0.12);
  }
  {
    const [x, y] = at(TILE_INDEX.bridge);
    for (let yy = 0; yy < TILE_PX; yy++) for (let xx = 0; xx < TILE_PX; xx++) pc.px(x + xx, y + yy, yy % 4 === 3 ? pal.plankDark : hash2(xx, yy) < 0.1 ? pal.plankDark : pal.plank);
    for (let xx = 0; xx < TILE_PX; xx++) {
      pc.px(x + xx, y, pal.plankDark);
      pc.px(x + xx, y + TILE_PX - 1, pal.plankDark);
    }
  }
  const stone = (idx: number, base: number, dark: number, seed: number, cracks: boolean): void => {
    const [x, y] = at(idx);
    noiseFill(pc, x, y, base, dark, shade(base, 1.12), seed, 0.2);
    if (cracks) {
      for (let k = 0; k < TILE_PX; k++) {
        if (k % 5 === 0) for (let xx = 0; xx < TILE_PX; xx++) pc.px(x + xx, y + k, dark);
        pc.px(x + ((k * 7 + (Math.floor(k / 5) % 2) * 5) % TILE_PX), y + k, dark);
      }
    }
  };
  stone(TILE_INDEX.rockTop, pal.rock, pal.rockDark, 40, false);
  stone(TILE_INDEX.rockSide, shade(pal.rock, 0.85), pal.rockDark, 41, true);
  {
    const [x, y] = at(TILE_INDEX.cliffTop);
    noiseFill(pc, x, y, pal.grass, pal.grassDark, pal.grassLight, 50);
  }
  stone(TILE_INDEX.cliffSide, pal.cliff, pal.cliffDark, 51, true);
  {
    const [x, y] = at(TILE_INDEX.plateauTop);
    noiseFill(pc, x, y, shade(pal.grass, 0.95), pal.grassDark, pal.grassLight, 60);
  }
  stone(TILE_INDEX.plateauSide, shade(pal.cliff, 0.95), pal.cliffDark, 61, true);
  {
    const [x, y] = at(TILE_INDEX.stairsTop);
    for (let yy = 0; yy < TILE_PX; yy++) for (let xx = 0; xx < TILE_PX; xx++) pc.px(x + xx, y + yy, yy % 4 < 1 ? pal.rockDark : pal.rock);
  }
  stone(TILE_INDEX.stairsSide, shade(pal.rock, 0.8), pal.rockDark, 71, true);
  {
    const [x, y] = at(TILE_INDEX.houseWall);
    for (let yy = 0; yy < TILE_PX; yy++)
      for (let xx = 0; xx < TILE_PX; xx++) {
        const beam = xx === 0 || xx === TILE_PX - 1 || yy === TILE_PX - 1;
        pc.px(x + xx, y + yy, beam ? pal.plank : hash2(xx + 80, yy) < 0.08 ? pal.wallDark : pal.wall);
      }
    for (let yy = 5; yy < 10; yy++) for (let xx = 5; xx < 11; xx++) pc.px(x + xx, y + yy, yy === 7 || xx === 8 ? pal.plankDark : 0x5a7aa8);
  }
  {
    const [x, y] = at(TILE_INDEX.roof);
    for (let yy = 0; yy < TILE_PX; yy++) for (let xx = 0; xx < TILE_PX; xx++) pc.px(x + xx, y + yy, (yy + (xx % 4 < 2 ? 0 : 2)) % 4 === 0 ? pal.roofDark : pal.roof);
  }
  {
    const [x, y] = at(TILE_INDEX.fenceTop);
    noiseFill(pc, x, y, pal.grass, pal.grassDark, pal.grassLight, 90);
    for (let xx = 0; xx < TILE_PX; xx++) {
      pc.px(x + xx, y + 7, pal.fence);
      pc.px(x + xx, y + 8, shade(pal.fence, 0.7));
    }
  }
  {
    const [x, y] = at(TILE_INDEX.fenceSide);
    for (let yy = 0; yy < TILE_PX; yy++)
      for (let xx = 0; xx < TILE_PX; xx++) {
        const post = xx % 8 < 2;
        const rail = yy === 3 || yy === 4 || yy === 10 || yy === 11;
        pc.px(x + xx, y + yy, post || rail ? (yy > 12 ? shade(pal.fence, 0.7) : pal.fence) : 0x000000, post || rail ? 255 : 0);
      }
  }
  {
    const [x, y] = at(TILE_INDEX.forestFloor);
    noiseFill(pc, x, y, pal.grassDark, shade(pal.grassDark, 0.75), pal.grass, 99, 0.3);
  }
  return { width: pc.width, height: pc.height, data: pc.toTextureData() };
}

/** Repeating forest-floor tile for the ground outside the playable map. */
export function generateForestFloor(): Tex {
  const pal = VALLEY_PALETTE;
  const pc = new PixelCanvas(TILE_PX, TILE_PX);
  noiseFill(pc, 0, 0, shade(pal.grassDark, 0.82), shade(pal.grassDark, 0.62), pal.grassDark, 99, 0.3);
  return { width: pc.width, height: pc.height, data: pc.toTextureData() };
}

/** Two tree variants side by side (48x64 each). */
export function generateTrees(pal = VALLEY_PALETTE): Tex {
  const pc = new PixelCanvas(96, 64);
  for (let v = 0; v < 2; v++) {
    pc.setOrigin(v * 48, 0, 1);
    pc.limb(24, 62, 24, 40, 6, pal.trunk, shade(pal.trunk, 0.7));
    const blobs: [number, number, number][] =
      v === 0
        ? [[24, 24, 15], [14, 32, 10], [34, 32, 10], [24, 12, 10]]
        : [[24, 30, 13], [24, 18, 11], [24, 8, 7], [16, 36, 8], [32, 36, 8]];
    for (const [x, y, r] of blobs) pc.ellipse(x, y, r, r * 0.9, pal.leaf, pal.leafDark);
    for (const [x, y, r] of blobs) pc.ellipse(x - r * 0.3, y - r * 0.35, r * 0.4, r * 0.3, pal.leafLight);
    pc.setOrigin(0, 0, 1);
    pc.outline(v * 48, 0, 48, 64, 0x16301a);
  }
  return { width: 96, height: 64, data: pc.toTextureData() };
}

export function generateWater(pal = VALLEY_PALETTE): Tex {
  const pc = new PixelCanvas(32, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const w = Math.sin((x + y * 0.5) * 0.4) + Math.sin((y - x * 0.3) * 0.55);
      pc.px(x, y, w > 1.3 ? pal.waterLight : w < -1.2 ? shade(pal.water, 0.8) : pal.water);
    }
  return { width: 32, height: 32, data: pc.toTextureData() };
}

/** Props atlas, 32x32 cells. */
export const PROP_CELLS = { chest: 0, chestOpen: 1, pickup: 2, stone: 3, crystalA: 4, crystalB: 5, boulder: 6, shadow: 7 } as const;

export function generateProps(pal = VALLEY_PALETTE): Tex {
  const pc = new PixelCanvas(8 * 32, 32);
  const cell = (i: number): void => pc.setOrigin(i * 32, 0, 1);
  // Chest closed / open.
  for (const open of [false, true]) {
    cell(open ? 1 : 0);
    pc.rect(6, 14, 20, 14, pal.plank);
    pc.rect(6, 14, 20, 2, pal.plankDark);
    pc.rect(6, 26, 20, 2, pal.plankDark);
    if (!open) {
      pc.rect(5, 8, 22, 7, shade(pal.plank, 1.1));
      pc.rect(14, 12, 4, 5, 0xf2d24a);
    } else {
      pc.rect(5, 4, 22, 5, shade(pal.plank, 1.1));
      pc.rect(8, 15, 16, 3, 0x2a1a0a);
    }
    pc.rect(9, 14, 2, 14, 0xb8b8c0);
    pc.rect(21, 14, 2, 14, 0xb8b8c0);
    pc.setOrigin(0, 0, 1);
    pc.outline((open ? 1 : 0) * 32, 0, 32, 32, 0x2a1a0a);
  }
  cell(PROP_CELLS.pickup);
  pc.ellipse(16, 22, 6, 6, 0x6ad84a, 0x3a9a2a);
  pc.tri(16, 10, 12, 20, 20, 20, 0x8af26a);
  pc.ellipse(14, 19, 1.5, 1.5, 0xffffff);
  cell(PROP_CELLS.stone);
  pc.ellipse(16, 22, 8, 6, pal.rock, pal.rockDark);
  pc.rect(12, 20, 8, 2, 0x4ac8f2);
  pc.rect(15, 17, 2, 8, 0x4ac8f2);
  for (const [i, glow] of [[PROP_CELLS.crystalA, 1], [PROP_CELLS.crystalB, 1.25]] as const) {
    cell(i);
    pc.tri(16, 2, 9, 18, 23, 18, shade(0x4ab8f2, glow));
    pc.tri(9, 18, 23, 18, 16, 30, shade(0x2a78c8, glow));
    pc.tri(16, 4, 12, 16, 16, 16, shade(0xbaf2ff, glow));
  }
  cell(PROP_CELLS.boulder);
  pc.ellipse(16, 18, 14, 13, pal.rock, pal.rockDark);
  pc.ellipse(11, 12, 5, 3, shade(pal.rock, 1.15));
  pc.limb(16, 6, 13, 16, 1.2, 0x3a3a44);
  pc.limb(13, 16, 19, 22, 1.2, 0x3a3a44);
  pc.limb(19, 22, 15, 30, 1.2, 0x3a3a44);
  cell(PROP_CELLS.shadow);
  pc.ellipse(16, 16, 15, 15, 0x000000);
  pc.setOrigin(0, 0, 1);
  for (const i of [2, 3, 4, 5, 6]) pc.outline(i * 32, 0, 32, 32, 0x1a1a22);
  // Soft shadow alpha.
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const idx = (y * pc.width + PROP_CELLS.shadow * 32 + x) * 4;
      if (pc.data[idx + 3] > 0) pc.data[idx + 3] = 90;
    }
  return { width: pc.width, height: pc.height, data: pc.toTextureData() };
}

/** Effects atlas (32x32 cells) + 8x10 digit glyphs in the last row. */
export const FX = {
  spark: [0, 1, 2, 3],
  kiBall: [4, 5],
  kiWave: [6, 7],
  kiCharged: [8, 9],
  explosion: [10, 11, 12, 13],
  aura: [14, 15],
  ring: 16,
  arrow: 17,
  alert: 18,
  dust: [19, 20],
  streak: 21,
  star: 22,
  shockwave: 23,
  disc: [24, 25],
  beamBody: 26,
  beamHead: 27,
  orb: [28, 29],
  scatter: 30,
  flash: 31,
} as const;
export const FX_COLS = 8;
export const FX_ROWS = 4;
export const DIGIT_ROW_Y = FX_ROWS * 32;

const DIGITS = [
  '01110,10001,10011,10101,11001,10001,01110',
  '00100,01100,00100,00100,00100,00100,01110',
  '01110,10001,00001,00110,01000,10000,11111',
  '11110,00001,00001,01110,00001,00001,11110',
  '00010,00110,01010,10010,11111,00010,00010',
  '11111,10000,11110,00001,00001,10001,01110',
  '00110,01000,10000,11110,10001,10001,01110',
  '11111,00001,00010,00100,01000,01000,01000',
  '01110,10001,10001,01110,10001,10001,01110',
  '01110,10001,10001,01111,00001,00010,01100',
  '00100,00100,00100,00100,00100,00000,00100',
];

export function generateEffects(): Tex {
  const pc = new PixelCanvas(FX_COLS * 32, FX_ROWS * 32 + 10);
  const cell = (i: number): void => pc.setOrigin((i % FX_COLS) * 32, Math.floor(i / FX_COLS) * 32, 1);
  FX.spark.forEach((i, f) => {
    cell(i);
    const r = 4 + f * 3;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + f * 0.3;
      pc.limb(16 + Math.cos(a) * (r * 0.4), 16 + Math.sin(a) * (r * 0.4), 16 + Math.cos(a) * r, 16 + Math.sin(a) * r, 2.2 - f * 0.4, f < 2 ? 0xffffff : 0xfff07a);
    }
    if (f < 2) pc.ellipse(16, 16, 4 - f, 4 - f, 0xffffff);
  });
  FX.kiBall.forEach((i, f) => {
    cell(i);
    pc.ellipse(16, 16, 9 + f, 9 + f, 0x6ac8ff);
    pc.ellipse(16, 16, 6, 6, 0xbaf2ff);
    pc.ellipse(15, 15, 3, 3, 0xffffff);
  });
  FX.kiWave.forEach((i, f) => {
    cell(i);
    pc.ellipse(16, 16, 14, 12 + f, 0x4a9aff);
    pc.ellipse(16, 16, 10, 8 + f, 0x9ad8ff);
    pc.ellipse(16, 16, 5, 4, 0xffffff);
  });
  FX.kiCharged.forEach((i, f) => {
    cell(i);
    pc.ellipse(16, 16, 12 + f, 12 + f, 0xffc84a);
    pc.ellipse(16, 16, 8, 8, 0xfff0a0);
    pc.ellipse(16, 16, 4, 4, 0xffffff);
  });
  FX.explosion.forEach((i, f) => {
    cell(i);
    const r = 6 + f * 3;
    pc.ellipse(16, 16, r, r, f < 2 ? 0xfff07a : 0xf28a3a);
    pc.ellipse(16, 16, r * 0.6, r * 0.6, f < 2 ? 0xffffff : 0xfff07a);
    if (f > 1) for (let k = 0; k < 5; k++) pc.ellipse(16 + Math.cos(k * 1.3) * r * 0.7, 16 + Math.sin(k * 1.3) * r * 0.7, 3, 3, 0x6a6a6a);
  });
  FX.aura.forEach((i, f) => {
    cell(i);
    for (let k = 0; k < 7; k++) {
      const x = 4 + k * 4;
      const h = 14 + ((k * 7 + f * 5) % 9);
      pc.tri(x - 3, 31, x + 3, 31, x + (f ? 1 : -1), 31 - h, 0xffffff);
    }
  });
  cell(FX.ring);
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    pc.ellipse(16 + Math.cos(t) * 13, 16 + Math.sin(t) * 13, 1.4, 1.4, 0xffffff);
  }
  cell(FX.arrow);
  pc.tri(8, 6, 24, 6, 16, 22, 0xff4a4a);
  pc.tri(11, 8, 21, 8, 16, 17, 0xff9a9a);
  cell(FX.alert);
  pc.rect(13, 3, 6, 17, 0xff3a3a);
  pc.rect(13, 23, 6, 6, 0xff3a3a);
  pc.rect(14, 4, 2, 14, 0xffaaaa);
  FX.dust.forEach((i, f) => {
    cell(i);
    pc.ellipse(16, 20, 8 + f * 3, 5 + f * 2, 0xd8c8a8);
  });
  cell(FX.streak);
  pc.rect(2, 15, 28, 2, 0xffffff);
  cell(FX.star);
  pc.tri(16, 2, 11, 20, 21, 20, 0xfff07a);
  pc.tri(16, 28, 11, 10, 21, 10, 0xfff07a);
  cell(FX.shockwave);
  for (let a = 0; a < 80; a++) {
    const t = (a / 80) * Math.PI * 2;
    pc.ellipse(16 + Math.cos(t) * 14, 16 + Math.sin(t) * 14, 1.6, 1.6, 0xffffff);
  }
  // Kienzan: flat spinning disc (two frames give the spin shimmer).
  FX.disc.forEach((i, f) => {
    cell(i);
    pc.ellipse(16, 16, 14, 5, 0xffd84a);
    pc.ellipse(16, 16, 10, 3, 0xfff4b0);
    pc.rect(f ? 6 : 20, 15, 6, 2, 0xffffff);
  });
  // Beam: tiling body (horizontal) and rounded head.
  cell(FX.beamBody);
  pc.rect(0, 4, 32, 24, 0x4aa8ff);
  pc.rect(0, 8, 32, 16, 0x9ad8ff);
  pc.rect(0, 12, 32, 8, 0xffffff);
  cell(FX.beamHead);
  pc.ellipse(16, 16, 15, 15, 0x4aa8ff);
  pc.ellipse(16, 16, 11, 11, 0x9ad8ff);
  pc.ellipse(16, 16, 6, 6, 0xffffff);
  FX.orb.forEach((i, f) => {
    cell(i);
    pc.ellipse(16, 16, 11, 11, 0xd8f4ff);
    pc.ellipse(16, 16, 8, 8, 0xffffff);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + f * 1;
      pc.ellipse(16 + Math.cos(a) * 9, 16 + Math.sin(a) * 9, 2.4, 2.4, 0x7ad0ff);
    }
  });
  cell(FX.scatter);
  pc.ellipse(16, 16, 7, 7, 0x6ad0ff);
  pc.ellipse(16, 16, 4, 4, 0xffffff);
  cell(FX.flash);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    pc.limb(16, 16, 16 + Math.cos(a) * 15, 16 + Math.sin(a) * 15, 2, 0xffffff);
  }
  pc.ellipse(16, 16, 8, 8, 0xffffff);
  pc.setOrigin(0, 0, 1);
  for (const i of [...FX.kiBall, ...FX.kiWave, ...FX.kiCharged, ...FX.disc, ...FX.orb, FX.scatter, FX.arrow, FX.alert]) pc.outline((i % FX_COLS) * 32, Math.floor(i / FX_COLS) * 32, 32, 32, 0x1a2a4a);
  DIGITS.forEach((glyph, d) => {
    glyph.split(',').forEach((row, y) => {
      for (let x = 0; x < 5; x++) if (row[x] === '1') pc.px(d * 8 + 1 + x, DIGIT_ROW_Y + 1 + y, 0xffffff);
    });
  });
  pc.outline(0, DIGIT_ROW_Y, DIGITS.length * 8, 10, 0x000000);
  return { width: pc.width, height: pc.height, data: pc.toTextureData() };
}

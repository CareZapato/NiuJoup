import * as THREE from 'three';
import { TILES, type TileChar } from '../../world/tiles';
import type { TileMap } from '../../world/TileMap';
import { hash2 } from './PixelCanvas';
import { ATLAS_COLS, ATLAS_ROWS, TILE_INDEX } from './worldArt';

export const WATER_LEVEL = -0.25;

/** Dirt-path cells in suelo_lozas.png, edges listed north, east, south, west. G = grass, D = dirt. */
const PATH_CELLS: { n: 'G' | 'D'; e: 'G' | 'D'; s: 'G' | 'D'; w: 'G' | 'D'; id: number }[] = [
  { n: 'D', e: 'D', s: 'D', w: 'D', id: 16 },
  { n: 'G', e: 'D', s: 'D', w: 'D', id: 17 },
  { n: 'D', e: 'G', s: 'D', w: 'D', id: 18 },
  { n: 'D', e: 'D', s: 'G', w: 'D', id: 19 },
  { n: 'D', e: 'D', s: 'D', w: 'G', id: 20 },
  { n: 'G', e: 'D', s: 'D', w: 'G', id: 21 },
  { n: 'G', e: 'G', s: 'D', w: 'D', id: 22 },
  { n: 'D', e: 'G', s: 'G', w: 'D', id: 23 },
];

function pathCell(map: TileMap, x: number, z: number): number {
  const edge = (dx: number, dz: number): 'G' | 'D' => {
    const n = map.charAt(x + dx, z + dz);
    return n === ':' || n === '=' ? 'D' : 'G';
  };
  const want = { n: edge(0, -1), e: edge(1, 0), s: edge(0, 1), w: edge(-1, 0) };
  let best = 16;
  let score = -1;
  for (const cell of PATH_CELLS) {
    let s = 0;
    if (cell.n === want.n) s++;
    if (cell.e === want.e) s++;
    if (cell.s === want.s) s++;
    if (cell.w === want.w) s++;
    if (s > score) {
      score = s;
      best = cell.id;
    }
  }
  return best;
}

/** Interior dirt, plus the ring and the footprint cells of arena_suelo.png. */
const ARENA_FILL = [0, 1, 2, 3, 4, 5, 6, 7, 24, 26, 27, 31];
const ARENA_STONE = [25, 29];

function pickId(ids: number[], h: number): number {
  return ids[Math.min(ids.length - 1, Math.floor(h * ids.length))]!;
}

/** Grass-border autotile for the training court. Outside means any tile that is not sand. */
function arenaCell(map: TileMap, x: number, z: number): number {
  const out = (dx: number, dz: number): boolean => map.charAt(x + dx, z + dz) !== 'G';
  const n = out(0, -1);
  const e = out(1, 0);
  const s = out(0, 1);
  const w = out(-1, 0);
  const h = hash2(x, z);
  if (!n && !e && !s && !w) return h > 0.94 ? pickId(ARENA_STONE, hash2(x + 4, z + 2)) : pickId(ARENA_FILL, h);
  if (n && w && !e && !s) return pickId([16, 20], h);
  if (n && e && !s && !w) return pickId([17, 21], h);
  if (s && w && !n && !e) return pickId([18, 22], h);
  if (s && e && !n && !w) return pickId([19, 23], h);
  if (n) return pickId([8, 12], h);
  if (s) return pickId([10, 14], h);
  if (e) return pickId([9, 13], h);
  return pickId([11, 15], h);
}

function topTile(map: TileMap, c: TileChar, x: number, z: number, painted: boolean): number {
  const h = hash2(x, z);
  if (painted) {
    const grass = Math.floor(h * 4);
    const flowers = 4 + Math.floor(hash2(x + 3, z + 9) * 4);
    switch (c) {
      case ',':
        return flowers;
      case ':':
        return pathCell(map, x, z);
      case 'G':
        return 30;
      case '=':
        return 25;
      case 'P':
      case 's':
        return 31;
      default:
        return grass;
    }
  }
  switch (c) {
    case ',':
      return TILE_INDEX.flowers;
    case ':':
      return TILE_INDEX.path[h < 0.5 ? 0 : 1];
    case 'G':
      return TILE_INDEX.sand;
    case '=':
      return TILE_INDEX.bridge;
    case '#':
      return TILE_INDEX.forestFloor;
    case 'o':
      return TILE_INDEX.rockTop;
    case '^':
      return TILE_INDEX.cliffTop;
    case 'P':
      return TILE_INDEX.plateauTop;
    case 's':
      return TILE_INDEX.stairsTop;
    case 'H':
      return TILE_INDEX.roof;
    case 'F':
      return TILE_INDEX.grass[Math.floor(h * 4)];
    default:
      return TILE_INDEX.grass[Math.floor(h * 4)];
  }
}

function sideTile(c: TileChar): number {
  switch (c) {
    case 'o':
      return TILE_INDEX.rockSide;
    case '^':
      return TILE_INDEX.cliffSide;
    case 'P':
      return TILE_INDEX.plateauSide;
    case 's':
      return TILE_INDEX.stairsSide;
    case 'H':
      return TILE_INDEX.houseWall;
    default:
      return TILE_INDEX.plateauSide;
  }
}

/** Render height: trees/forest are drawn as billboards on flat ground. */
function renderHeight(map: TileMap, x: number, z: number): number {
  if (!map.inBounds(x, z)) return 0;
  const c = map.charAt(x, z);
  const d = TILES[c];
  if (d.liquid) return WATER_LEVEL;
  if (d.render === 'tree' || c === 'F' || c === '=' || c === 'H' || c === 'o') return 0;
  return d.height;
}

/**
 * Builds the whole map (ground, plateaus, cliffs, houses, fences) as ONE mesh
 * with one atlas texture: a single draw call, cheap on mobile GPUs.
 */
/**
 * `sand` true omits the training court (drawn from arena_suelo.png).
 * `'only'` emits just that court, with the arena sheet's 8×4 cells.
 */
export function buildTerrainGeometry(map: TileMap, painted = false, sand: boolean | 'only' = false): THREE.BufferGeometry {
  const onlySand = sand === 'only';
  const skipSand = sand === true;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const uvW = 1 / ATLAS_COLS;
  const uvH = 1 / ATLAS_ROWS;
  const inset = 0.002;

  const quad = (p: number[][], tile: number, light: number, vTop = 1, vBot = 0): void => {
    const base = pos.length / 3;
    const cx = tile % ATLAS_COLS;
    const cy = Math.floor(tile / ATLAS_COLS);
    const u0 = cx * uvW + inset;
    const u1 = (cx + 1) * uvW - inset;
    // DataTexture rows are bottom-up: atlas row 0 is at the top of the image.
    const vT = 1 - cy * uvH - inset - (1 - vTop) * uvH;
    const vB = 1 - (cy + 1) * uvH + inset + vBot * uvH;
    const uvs = [
      [u0, vT],
      [u1, vT],
      [u0, vB],
      [u1, vB],
    ];
    for (let i = 0; i < 4; i++) {
      pos.push(p[i][0], p[i][1], p[i][2]);
      uv.push(uvs[i][0], uvs[i][1]);
      col.push(light, light, light);
    }
    idx.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
  };

  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < map.width; x++) {
      const c = map.charAt(x, z);
      if (onlySand && c !== 'G') continue;
      if (skipSand && c === 'G') continue;
      const h = renderHeight(map, x, z);
      if (!TILES[c].liquid) {
        // Top face (NW, NE, SW, SE).
        quad(
          [
            [x, h, z],
            [x + 1, h, z],
            [x, h, z + 1],
            [x + 1, h, z + 1],
          ],
          onlySand ? arenaCell(map, x, z) : topTile(map, c, x, z, painted),
          1,
        );
      }
      // Side faces toward lower neighbours, split per unit of height so the texture tiles.
      const sides: [number, number, number][] = [
        [0, 1, 0.88],
        [1, 0, 0.74],
        [-1, 0, 0.7],
        [0, -1, 0.6],
      ];
      for (const [dx, dz, light] of sides) {
        const nh = renderHeight(map, x + dx, z + dz);
        if (nh >= h) continue;
        if (painted && (c === '^' || c === 'P')) continue;
        const tile = painted ? (c === 's' ? 31 : 25) : TILES[c].liquid ? TILE_INDEX.path[0] : h <= 0 ? TILE_INDEX.path[1] : sideTile(c);
        let y0 = nh;
        while (y0 < h - 1e-4) {
          const y1 = Math.min(h, Math.floor(y0 + 1 + 1e-4));
          const seg = y1 - y0;
          let p: number[][];
          if (dz === 1)
            p = [
              [x, y1, z + 1],
              [x + 1, y1, z + 1],
              [x, y0, z + 1],
              [x + 1, y0, z + 1],
            ];
          else if (dz === -1)
            p = [
              [x + 1, y1, z],
              [x, y1, z],
              [x + 1, y0, z],
              [x, y0, z],
            ];
          else if (dx === 1)
            p = [
              [x + 1, y1, z + 1],
              [x + 1, y1, z],
              [x + 1, y0, z + 1],
              [x + 1, y0, z],
            ];
          else
            p = [
              [x, y1, z],
              [x, y1, z + 1],
              [x, y0, z],
              [x, y0, z + 1],
            ];
          quad(p, tile, light, 1, 1 - seg);
          y0 = y1;
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Dense forest ring just outside the map so the world edge reads as more
 * forest (never sky or water) from any camera angle. Deterministic.
 */
export function exteriorTreePositions(map: TileMap, band: number, spacing: number): { x: number; z: number; variant: number; size: number }[] {
  const out: { x: number; z: number; variant: number; size: number }[] = [];
  const W = map.width;
  const H = map.height;
  for (let z = -band; z < H + band; z += spacing) {
    for (let x = -band; x < W + band; x += spacing) {
      const inside = x >= 0 && x < W && z >= 0 && z < H;
      if (inside) continue;
      const h = hash2(Math.round(x * 7) + 101, Math.round(z * 7) + 57);
      const out1 = Math.max(-x, x - W, -z, z - H, 0);
      out.push({
        x: x + (h - 0.5) * spacing * 0.7,
        z: z + (hash2(Math.round(z * 5), Math.round(x * 5)) - 0.5) * spacing * 0.7,
        variant: Math.floor(h * 4) % 4,
        size: 1.2 + h * 0.35 + out1 * 0.06,
      });
    }
  }
  return out;
}

export function treePositions(map: TileMap): { x: number; z: number; variant: number; size: number }[] {
  const out: { x: number; z: number; variant: number; size: number }[] = [];
  for (let z = 0; z < map.height; z++)
    for (let x = 0; x < map.width; x++) {
      const c = map.charAt(x, z);
      if (c !== 'T' && c !== '#') continue;
      const h = hash2(x + 7, z + 3);
      out.push({ x: x + 0.5 + (h - 0.5) * 0.3, z: z + 0.5 + (hash2(z, x) - 0.5) * 0.3, variant: Math.floor(hash2(x + 1, z + 5) * 4) % 4, size: c === '#' ? 1.15 + h * 0.3 : 0.95 + h * 0.25 });
    }
  return out;
}

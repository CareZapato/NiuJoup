import * as THREE from 'three';
import { TILES, type TileChar } from '../../world/tiles';
import type { TileMap } from '../../world/TileMap';
import { hash2 } from './PixelCanvas';
import { ATLAS_COLS, ATLAS_ROWS, TILE_INDEX } from './worldArt';

export const WATER_LEVEL = -0.25;

function topTile(c: TileChar, x: number, z: number): number {
  const h = hash2(x, z);
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
  if (d.render === 'tree' || c === 'F' || c === '=') return 0;
  return d.height;
}

/**
 * Builds the whole map (ground, plateaus, cliffs, houses, fences) as ONE mesh
 * with one atlas texture: a single draw call, cheap on mobile GPUs.
 */
export function buildTerrainGeometry(map: TileMap): THREE.BufferGeometry {
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
          topTile(c, x, z),
          1,
        );
      }
      if (c === 'F') {
        const alongX = map.charAt(x - 1, z) === 'F' || map.charAt(x + 1, z) === 'F';
        const fh = TILES.F.height;
        const p = alongX
          ? [
              [x, fh, z + 0.5],
              [x + 1, fh, z + 0.5],
              [x, 0, z + 0.5],
              [x + 1, 0, z + 0.5],
            ]
          : [
              [x + 0.5, fh, z],
              [x + 0.5, fh, z + 1],
              [x + 0.5, 0, z],
              [x + 0.5, 0, z + 1],
            ];
        quad(p, TILE_INDEX.fenceSide, 0.95);
        quad([p[1], p[0], p[3], p[2]], TILE_INDEX.fenceSide, 0.8);
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
        const tile = TILES[c].liquid ? TILE_INDEX.path[0] : h <= 0 ? TILE_INDEX.path[1] : sideTile(c);
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
        variant: h < 0.5 ? 0 : 1,
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
      out.push({ x: x + 0.5 + (h - 0.5) * 0.3, z: z + 0.5 + (hash2(z, x) - 0.5) * 0.3, variant: h < 0.5 ? 0 : 1, size: c === '#' ? 1.15 + h * 0.3 : 0.95 + h * 0.25 });
    }
  return out;
}

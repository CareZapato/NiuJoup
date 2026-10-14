import type { TileChar } from './tiles';

/** Tiles whose ground quad follows the sculpted relief. Collision heights stay on the tile def. */
const SOFT = new Set<TileChar>(['.', ',', ':', 'T', '#', 'o']);

function hash(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function falloff(d: number, reach: number): number {
  if (d <= 0) return 1;
  if (d >= reach) return 0;
  const t = 1 - d / reach;
  return t * t;
}

function distances(w: number, h: number, tiles: TileChar[], source: (c: TileChar) => boolean): Int16Array {
  const dist = new Int16Array(w * h);
  dist.fill(999);
  const q: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (!source(tiles[i])) continue;
    dist[i] = 0;
    q.push(i);
  }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    const x = i % w;
    const z = (i / w) | 0;
    const nd = dist[i] + 1;
    const step = (x2: number, z2: number): void => {
      if (x2 < 0 || z2 < 0 || x2 >= w || z2 >= h) return;
      const j = z2 * w + x2;
      if (dist[j] <= nd) return;
      dist[j] = nd;
      q.push(j);
    };
    step(x + 1, z);
    step(x - 1, z);
    step(x, z + 1);
    step(x, z - 1);
  }
  return dist;
}

/**
 * Gentle ground relief that follows the map: banks fall toward the river,
 * land rises toward cliffs, the plateau and the forest edge, and the village
 * and the training court stay flat. Adjacent soft tiles stay within a step.
 */
export function bakeGroundLift(w: number, h: number, tiles: TileChar[]): Float32Array {
  const lift = new Float32Array(w * h);
  const waterD = distances(w, h, tiles, (c) => c === '~');
  const highD = distances(w, h, tiles, (c) => c === '^' || c === 'P');
  const woodD = distances(w, h, tiles, (c) => c === '#');
  const homeD = distances(w, h, tiles, (c) => c === 'H' || c === 'G');
  const soft = (i: number): boolean => SOFT.has(tiles[i]);

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      if (!soft(i)) continue;
      let y = 0;
      y -= 0.26 * falloff(waterD[i], 5);
      y += 0.4 * falloff(highD[i], 8);
      y += 0.16 * falloff(woodD[i], 4);
      y += (hash(x, z) - 0.5) * 0.08;
      lift[i] = y;
    }
  }

  const blur = new Float32Array(w * h);
  for (let pass = 0; pass < 4; pass++) {
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        if (!soft(i)) continue;
        let acc = lift[i];
        let n = 1;
        const take = (x2: number, z2: number): void => {
          if (x2 < 0 || z2 < 0 || x2 >= w || z2 >= h) return;
          const j = z2 * w + x2;
          if (!soft(j)) return;
          acc += lift[j];
          n++;
        };
        take(x + 1, z);
        take(x - 1, z);
        take(x, z + 1);
        take(x, z - 1);
        blur[i] = acc / n;
      }
    }
    lift.set(blur);
  }

  const MAX_STEP = 0.2;
  for (let pass = 0; pass < 6; pass++) {
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        if (!soft(i)) continue;
        const pull = (x2: number, z2: number): void => {
          if (x2 < 0 || z2 < 0 || x2 >= w || z2 >= h) return;
          const j = z2 * w + x2;
          if (!soft(j)) return;
          const gap = lift[i] - lift[j];
          if (gap > MAX_STEP) lift[i] -= (gap - MAX_STEP) * 0.5;
          else if (gap < -MAX_STEP) lift[i] -= (gap + MAX_STEP) * 0.5;
        };
        pull(x + 1, z);
        pull(x, z + 1);
      }
    }
  }

  for (let i = 0; i < lift.length; i++) {
    if (!soft(i)) {
      lift[i] = 0;
      continue;
    }
    // Village and the training court stay a flat pad; the land feathers back in outside it.
    if (homeD[i] <= 2) lift[i] = 0;
    else lift[i] *= 1 - falloff(homeD[i] - 2, 4);
    if (lift[i] > 0.42) lift[i] = 0.42;
    if (lift[i] < -0.28) lift[i] = -0.28;
  }

  // Keep every walkable step inside the step-up, including the flat pads.
  for (let pass = 0; pass < 8; pass++) {
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        if (!soft(i) || homeD[i] <= 2) continue;
        const ease = (x2: number, z2: number): void => {
          if (x2 < 0 || z2 < 0 || x2 >= w || z2 >= h) return;
          const j = z2 * w + x2;
          if (!soft(j)) return;
          const gap = lift[i] - lift[j];
          if (gap > 0.2) lift[i] = lift[j] + 0.2;
          else if (gap < -0.2) lift[i] = lift[j] - 0.2;
        };
        ease(x + 1, z);
        ease(x - 1, z);
        ease(x, z + 1);
        ease(x, z - 1);
      }
    }
  }
  return lift;
}

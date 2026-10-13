import type { TalkLine } from '../dialogue';
import { Rng } from '../../core/math';
import { TileMap } from '../../world/TileMap';
import type { TileChar } from '../../world/tiles';

export interface NpcDef {
  id: string;
  name: string;
  x: number;
  z: number;
  appearance: 'master' | 'villager' | 'smith';
  dialogue: TalkLine[];
}
export interface ChestDef {
  id: string;
  x: number;
  z: number;
  items: { itemId: string; count: number }[];
  money: number;
}
export interface PickupDef {
  id: string;
  x: number;
  z: number;
  itemId: string;
  count: number;
}
export interface EnemyGroupDef {
  id: string;
  x: number;
  z: number;
  members: { stableId: string; enemyId: string }[];
  patrolRadius: number;
}
export interface AreaDef {
  id: string;
  name: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
export interface BoulderDef {
  id: string;
  x: number;
  z: number;
}

export interface MapDef {
  id: string;
  name: string;
  biome: 'valley';
  tiles: TileMap;
  start: { x: number; z: number };
  recovery: { id: string; x: number; z: number };
  npcs: NpcDef[];
  chests: ChestDef[];
  pickups: PickupDef[];
  enemyGroups: EnemyGroupDef[];
  boulders: BoulderDef[];
  areas: AreaDef[];
  /** Path lamps. White marks in the village, road and sand court; the bridge corner is the red mark. */
  lamps: { x: number; z: number }[];
}

class MapBuilder {
  readonly t: TileChar[];
  constructor(
    readonly w: number,
    readonly h: number,
    fill: TileChar,
  ) {
    this.t = new Array<TileChar>(w * h).fill(fill);
  }
  set(x: number, z: number, c: TileChar): void {
    if (x >= 0 && z >= 0 && x < this.w && z < this.h) this.t[z * this.w + x] = c;
  }
  get(x: number, z: number): TileChar {
    return this.t[z * this.w + x];
  }
  rect(x0: number, z0: number, x1: number, z1: number, c: TileChar): void {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, z, c);
  }
  outline(x0: number, z0: number, x1: number, z1: number, c: TileChar): void {
    for (let x = x0; x <= x1; x++) {
      this.set(x, z0, c);
      this.set(x, z1, c);
    }
    for (let z = z0; z <= z1; z++) {
      this.set(x0, z, c);
      this.set(x1, z, c);
    }
  }
}

/** Builds the "Valle de entrenamiento" deterministically. 64x48 tiles. */
export function buildValley(): MapDef {
  const W = 64;
  const H = 48;
  const b = new MapBuilder(W, H, '.');
  const rng = new Rng(1996);

  b.outline(0, 0, W - 1, H - 1, '#');
  b.outline(1, 1, W - 2, H - 2, '#');

  // River (meanders north-south) with a bridge on the main road.
  for (let z = 2; z < H - 2; z++) {
    const cx = 38 + Math.round(Math.sin(z * 0.22) * 1.5);
    b.rect(cx - 1, z, cx + 1, z, '~');
  }

  // Village (north-west).
  b.rect(3, 8, 21, 9, ':');
  b.rect(10, 3, 11, 9, ':');
  b.rect(5, 4, 8, 6, 'H');
  b.rect(13, 4, 17, 6, 'H');
  b.rect(4, 11, 7, 13, 'H');
  b.outline(3, 15, 9, 15, 'F');

  // Main road: village -> south -> bridge -> training ground.
  b.rect(20, 9, 21, 24, ':');
  b.rect(20, 23, 49, 24, ':');
  for (let x = 34; x <= 43; x++) for (let z = 23; z <= 24; z++) if (b.get(x, z) === '~') b.set(x, z, '=');
  b.rect(11, 9, 12, 30, ':');

  // Training ground (east) with fences.
  b.rect(44, 18, 58, 29, 'G');
  b.outline(44, 18, 58, 29, 'F');
  b.rect(44, 23, 44, 24, ':');

  // North-east cliffs with a hidden zone behind a cracked boulder.
  b.rect(42, 2, 61, 15, '^');
  b.rect(49, 4, 58, 11, '.');
  b.rect(45, 11, 48, 11, '.');
  b.rect(45, 11, 45, 16, '.');

  // South-east plateau (mini-boss) reached by stairs.
  b.rect(44, 33, 60, 45, 'P');
  b.rect(46, 32, 47, 32, 's');
  b.outline(43, 32, 61, 46, '^');
  b.rect(46, 32, 47, 32, 's');
  b.rect(46, 31, 47, 31, 's');

  // Rocks (jumpable), flowers and tree clusters.
  const rocks: [number, number][] = [[23, 20], [24, 20], [27, 30], [17, 26], [31, 34], [32, 34], [16, 38], [29, 14]];
  for (const [x, z] of rocks) b.set(x, z, 'o');

  const keepClear = (x: number, z: number): boolean => {
      const clear: [number, number, number][] = [
      [24, 17, 4], [20, 34, 4], [30, 40, 4], [13, 10, 3], [16, 12, 2], [28, 28, 2], [33, 15, 2], [15, 41, 2], [26, 37, 3],
    ];
    return clear.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r);
  };
  for (let z = 2; z < H - 2; z++) {
    for (let x = 2; x < W - 2; x++) {
      if (b.get(x, z) !== '.') continue;
      if (keepClear(x, z)) continue;
      const inMeadow = x > 13 && x < 36 && z > 12;
      const edge = x < 4 || z > 43 || x > 59;
      const r = rng.next();
      if ((edge && r < 0.35) || (inMeadow && r < 0.035) || (!inMeadow && r < 0.05)) b.set(x, z, 'T');
      else if (r > 0.9) b.set(x, z, ',');
    }
  }
  // The tree on this tile stood in front of the smith and hid him.
  b.set(8, 10, '.');

  const tiles = new TileMap(W, H, b.t);

  const valley: MapDef = {
    id: 'valley',
    name: 'Valle de entrenamiento',
    biome: 'valley',
    tiles,
    start: { x: 13.5, z: 10.5 },
    recovery: { id: 'valley_crystal_point', x: 16.5, z: 12.5 },
    npcs: [
      {
        id: 'master',
        name: 'Maestro Hoku',
        x: 10.5,
        z: 7.5,
        appearance: 'master',
        dialogue: [
          { text: 'Bienvenido de nuevo. El valle es perfecto para entrenar.', expression: 'smile' },
          { text: 'Recuerda: J, J, K encadena un combo. U para defenderte, I para cargar Ki.', expression: 'serious' },
        ],
      },
      {
        id: 'villager_a',
        name: 'Aldeana Mira',
        x: 18.5,
        z: 10.5,
        appearance: 'villager',
        dialogue: [
          { text: 'Hay una roca agrietada al noreste, junto a los riscos.', expression: 'neutral' },
          { text: 'Dicen que un Kamehameha, un Kienzan o un Sōkidan la harían pedazos...', expression: 'surprise' },
        ],
      },
      {
        id: 'smith',
        name: 'Herrero Bram',
        x: 8.5,
        z: 9.5,
        appearance: 'smith',
        dialogue: [
          { text: 'El cristal azul junto a la plaza restaura energías y guarda tu progreso.', expression: 'smile' },
          { text: 'Pulsa Tab para cambiar de líder del grupo.', expression: 'neutral' },
        ],
      },
    ],
    chests: [
      { id: 'chest_village', x: 19.5, z: 4.5, items: [{ itemId: 'herb', count: 2 }], money: 20 },
      { id: 'chest_meadow', x: 26.5, z: 37.5, items: [{ itemId: 'ki_capsule', count: 2 }], money: 30 },
      { id: 'chest_secret', x: 55.5, z: 7.5, items: [{ itemId: 'ancient_relic', count: 1 }, { itemId: 'herb', count: 3 }], money: 120 },
    ],
    pickups: [
      { id: 'stone_a', x: 33.5, z: 15.5, itemId: 'training_stone', count: 1 },
      { id: 'stone_b', x: 15.5, z: 41.5, itemId: 'training_stone', count: 1 },
      { id: 'herb_meadow', x: 28.5, z: 28.5, itemId: 'herb', count: 1 },
      { id: 'crystal_secret', x: 51.5, z: 5.5, itemId: 'valley_crystal', count: 1 },
    ],
    enemyGroups: [
      { id: 'g_meadow_1', x: 24.5, z: 17.5, patrolRadius: 2.5, members: [{ stableId: 'e_sprout_1', enemyId: 'sprout' }] },
      { id: 'g_meadow_2', x: 20.5, z: 34.5, patrolRadius: 2.5, members: [{ stableId: 'e_sprout_2', enemyId: 'sprout' }, { stableId: 'e_sprout_3', enemyId: 'sprout' }] },
      { id: 'g_south', x: 30.5, z: 40.5, patrolRadius: 2.5, members: [{ stableId: 'e_bandit_1', enemyId: 'bandit' }, { stableId: 'e_sprout_4', enemyId: 'sprout' }] },
      {
        id: 'g_training',
        x: 51.5,
        z: 24.5,
        patrolRadius: 3,
        members: [
          { stableId: 'e_bandit_2', enemyId: 'bandit' },
          { stableId: 'e_bandit_3', enemyId: 'bandit' },
          { stableId: 'e_sprout_5', enemyId: 'sprout' },
        ],
      },
      { id: 'g_boss', x: 53.5, z: 40.5, patrolRadius: 1.5, members: [{ stableId: 'e_golem', enemyId: 'golem' }] },
    ],
    boulders: [{ id: 'boulder_secret', x: 45.5, z: 14.5 }],
    areas: [
      { id: 'village', name: 'Aldea', x0: 2, z0: 2, x1: 22, z1: 16 },
      { id: 'meadow', name: 'Pradera', x0: 14, z0: 26, x1: 34, z1: 44 },
      { id: 'training', name: 'Zona de entrenamiento', x0: 44, z0: 18, x1: 58, z1: 29 },
      { id: 'secret', name: 'Rincón oculto', x0: 49, z0: 4, x1: 58, z1: 11 },
      { id: 'plateau', name: 'Meseta del risco', x0: 44, z0: 33, x1: 60, z1: 45 },
    ],
    lamps: [
      { x: 8.6, z: 6.4 },
      { x: 13.6, z: 6.4 },
      { x: 11.1, z: 13.8 },
      { x: 14.2, z: 12.2 },
      { x: 8.6, z: 17.2 },
      { x: 14.4, z: 17.2 },
      { x: 18.4, z: 22.4 },
      { x: 18.4, z: 25.6 },
      { x: 26.2, z: 22.4 },
      { x: 26.2, z: 25.6 },
      { x: 33.2, z: 22.4 },
      { x: 36.8, z: 25.8 },
      { x: 42.2, z: 22.4 },
      { x: 42.2, z: 25.6 },
      { x: 43.2, z: 21.5 },
      { x: 43.2, z: 26.5 },
      { x: 46.4, z: 17.6 },
      { x: 46.4, z: 29.4 },
      { x: 56.6, z: 17.6 },
      { x: 56.6, z: 29.4 },
    ],
  };
  for (const lamp of valley.lamps) valley.tiles.addCircleBlocker(lamp.x, lamp.z, 0.34, 2.4);
  return valley;
}

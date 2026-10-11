export type TileChar = '.' | ',' | ':' | '~' | '=' | '#' | 'T' | 'o' | '^' | 'P' | 's' | 'H' | 'F' | 'G';

export interface TileDef {
  name: string;
  /** Surface height in world units. Entities can step up `stepUp`, jump higher, and fly over anything. */
  height: number;
  /** Ground entities cannot enter (water). Flyers can. */
  liquid: boolean;
  /** Visual layer used by the renderer. */
  render: 'ground' | 'block' | 'tree' | 'water';
}

export const TILES: Record<TileChar, TileDef> = {
  '.': { name: 'grass', height: 0, liquid: false, render: 'ground' },
  ',': { name: 'flowers', height: 0, liquid: false, render: 'ground' },
  ':': { name: 'path', height: 0, liquid: false, render: 'ground' },
  G: { name: 'sand', height: 0, liquid: false, render: 'ground' },
  '~': { name: 'water', height: 0, liquid: true, render: 'water' },
  '=': { name: 'bridge', height: 0.12, liquid: false, render: 'ground' },
  '#': { name: 'forest', height: 4.5, liquid: false, render: 'tree' },
  T: { name: 'tree', height: 3.4, liquid: false, render: 'tree' },
  o: { name: 'rock', height: 0.75, liquid: false, render: 'block' },
  '^': { name: 'cliff', height: 2.6, liquid: false, render: 'block' },
  P: { name: 'plateau', height: 1.1, liquid: false, render: 'block' },
  s: { name: 'stairs', height: 0.55, liquid: false, render: 'block' },
  H: { name: 'house', height: 2.8, liquid: false, render: 'block' },
  F: { name: 'fence', height: 0.6, liquid: false, render: 'block' },
};

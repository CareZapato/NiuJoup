import { TILES, type TileChar, type TileDef } from './tiles';

export class TileMap {
  readonly tiles: TileChar[];
  /** Tile-indexed overrides for dynamic blockers (e.g. breakable boulders), height or -1. */
  private dynamicHeight: Float32Array;

  constructor(
    readonly width: number,
    readonly height: number,
    tiles: TileChar[],
  ) {
    if (tiles.length !== width * height) throw new Error(`TileMap size mismatch ${tiles.length} != ${width * height}`);
    this.tiles = tiles;
    this.dynamicHeight = new Float32Array(width * height).fill(-1);
  }

  inBounds(tx: number, tz: number): boolean {
    return tx >= 0 && tz >= 0 && tx < this.width && tz < this.height;
  }

  charAt(tx: number, tz: number): TileChar {
    if (!this.inBounds(tx, tz)) return '#';
    return this.tiles[tz * this.width + tx];
  }

  defAt(tx: number, tz: number): TileDef {
    return TILES[this.charAt(tx, tz)];
  }

  /** Surface height at a world position (tile centers are at +0.5). */
  heightAt(x: number, z: number): number {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (!this.inBounds(tx, tz)) return 99;
    const dyn = this.dynamicHeight[tz * this.width + tx];
    const base = TILES[this.tiles[tz * this.width + tx]].height;
    return dyn > base ? dyn : base;
  }

  isLiquid(x: number, z: number): boolean {
    return this.defAt(Math.floor(x), Math.floor(z)).liquid;
  }

  setDynamicBlocker(tx: number, tz: number, h: number): void {
    if (this.inBounds(tx, tz)) this.dynamicHeight[tz * this.width + tx] = h;
  }

  clearDynamicBlocker(tx: number, tz: number): void {
    if (this.inBounds(tx, tz)) this.dynamicHeight[tz * this.width + tx] = -1;
  }

  /**
   * Can a circle of `radius` at (x,z) with feet at height y occupy this spot?
   * Samples the four extremes of the circle against tile heights.
   */
  canOccupy(x: number, z: number, y: number, radius: number, stepUp: number, flying: boolean): boolean {
    for (let i = 0; i < 4; i++) {
      const sx = x + (i === 0 ? radius : i === 1 ? -radius : 0);
      const sz = z + (i === 2 ? radius : i === 3 ? -radius : 0);
      const h = this.heightAt(sx, sz);
      if (h > y + stepUp) return false;
      if (!flying && y < 0.05 && this.isLiquid(sx, sz)) return false;
    }
    return true;
  }

  /** Grid line-of-sight: blocked by tiles taller than eye height. */
  lineOfSight(ax: number, az: number, bx: number, bz: number, eyeHeight: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len * 3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.heightAt(ax + dx * t, az + dz * t) > eyeHeight) return false;
    }
    return true;
  }

  toAscii(): string {
    const rows: string[] = [];
    for (let z = 0; z < this.height; z++) rows.push(this.tiles.slice(z * this.width, (z + 1) * this.width).join(''));
    return rows.join('\n');
  }
}

/** RGBA software canvas for generating original placeholder pixel art (top-down rows). */
export class PixelCanvas {
  readonly data: Uint8Array;
  /** Drawing origin + scale so the same art code renders at 32x48 or 64x96. */
  ox = 0;
  oy = 0;
  s = 1;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  setOrigin(ox: number, oy: number, s: number): void {
    this.ox = ox;
    this.oy = oy;
    this.s = s;
  }

  px(x: number, y: number, c: number, a = 255): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = (c >> 16) & 255;
    this.data[i + 1] = (c >> 8) & 255;
    this.data[i + 2] = c & 255;
    this.data[i + 3] = a;
  }

  alphaAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[(y * this.width + x) * 4 + 3];
  }

  /** Rect in design units (scaled + offset). */
  rect(x: number, y: number, w: number, h: number, c: number): void {
    const s = this.s;
    const x0 = Math.round(this.ox + x * s);
    const y0 = Math.round(this.oy + y * s);
    const x1 = Math.round(this.ox + (x + w) * s);
    const y1 = Math.round(this.oy + (y + h) * s);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px(xx, yy, c);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: number, shade?: number): void {
    const s = this.s;
    const pcx = this.ox + cx * s;
    const pcy = this.oy + cy * s;
    const prx = rx * s;
    const pry = ry * s;
    for (let y = Math.floor(pcy - pry); y <= Math.ceil(pcy + pry); y++) {
      for (let x = Math.floor(pcx - prx); x <= Math.ceil(pcx + prx); x++) {
        const dx = (x + 0.5 - pcx) / prx;
        const dy = (y + 0.5 - pcy) / pry;
        const d = dx * dx + dy * dy;
        if (d <= 1) this.px(x, y, shade !== undefined && dx + dy > 0.55 ? shade : c);
      }
    }
  }

  /** Thick line (limb) between two design-space points. */
  limb(x0: number, y0: number, x1: number, y1: number, thick: number, c: number, shade?: number): void {
    const s = this.s;
    const ax = this.ox + x0 * s;
    const ay = this.oy + y0 * s;
    const bx = this.ox + x1 * s;
    const by = this.oy + y1 * s;
    const r = (thick * s) / 2;
    const minX = Math.floor(Math.min(ax, bx) - r);
    const maxX = Math.ceil(Math.max(ax, bx) + r);
    const minY = Math.floor(Math.min(ay, by) - r);
    const maxY = Math.ceil(Math.max(ay, by) + r);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + dx * t - px;
        const qy = ay + dy * t - py;
        const d = Math.sqrt(qx * qx + qy * qy);
        if (d <= r) this.px(x, y, shade !== undefined && (qx < -r * 0.35 || qy < -r * 0.35) ? shade : c);
      }
    }
  }

  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: number): void {
    const s = this.s;
    const p = [
      [this.ox + ax * s, this.oy + ay * s],
      [this.ox + bx * s, this.oy + by * s],
      [this.ox + cx * s, this.oy + cy * s],
    ];
    const minX = Math.floor(Math.min(p[0][0], p[1][0], p[2][0]));
    const maxX = Math.ceil(Math.max(p[0][0], p[1][0], p[2][0]));
    const minY = Math.floor(Math.min(p[0][1], p[1][1], p[2][1]));
    const maxY = Math.ceil(Math.max(p[0][1], p[1][1], p[2][1]));
    const edge = (a: number[], b: number[], x: number, y: number): number => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = edge(p[1], p[2], x + 0.5, y + 0.5);
        const w1 = edge(p[2], p[0], x + 0.5, y + 0.5);
        const w2 = edge(p[0], p[1], x + 0.5, y + 0.5);
        if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) this.px(x, y, c);
      }
    }
  }

  /** 1px dark outline around opaque pixels inside a cell (classic sprite look). */
  outline(x0: number, y0: number, w: number, h: number, c: number): void {
    const mark: number[] = [];
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (this.alphaAt(x, y) > 0) continue;
        if (
          (x > x0 && this.alphaAt(x - 1, y) > 0 && this.notOutline(x - 1, y, c)) ||
          (x < x0 + w - 1 && this.alphaAt(x + 1, y) > 0 && this.notOutline(x + 1, y, c)) ||
          (y > y0 && this.alphaAt(x, y - 1) > 0 && this.notOutline(x, y - 1, c)) ||
          (y < y0 + h - 1 && this.alphaAt(x, y + 1) > 0 && this.notOutline(x, y + 1, c))
        )
          mark.push(x, y);
      }
    }
    for (let i = 0; i < mark.length; i += 2) this.px(mark[i], mark[i + 1], c);
  }

  private notOutline(x: number, y: number, c: number): boolean {
    const i = (y * this.width + x) * 4;
    return !(this.data[i] === ((c >> 16) & 255) && this.data[i + 1] === ((c >> 8) & 255) && this.data[i + 2] === (c & 255));
  }

  /** Returns rows bottom-up, as WebGL/expo-gl DataTextures expect with flipY = false. */
  toTextureData(): Uint8Array {
    const out = new Uint8Array(this.data.length);
    const row = this.width * 4;
    for (let y = 0; y < this.height; y++) out.set(this.data.subarray(y * row, (y + 1) * row), (this.height - 1 - y) * row);
    return out;
  }
}

export function shade(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

/** Deterministic hash for tile variation. */
export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

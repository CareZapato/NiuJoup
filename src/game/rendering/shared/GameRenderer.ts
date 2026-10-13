import * as THREE from 'three';
import type { Entity } from '../../components';
import { getMove } from '../../content/moves';
import type { ProjectileVisual } from '../../content/types';
import type { GameEvents } from '../../events';
import type { Game } from '../../Game';
import { isAttacking } from '../../systems/combat/CombatSystem';
import { hitboxCenter } from '../../systems/collision/shapes';
import { vec3 } from '../../core/math';
import { BALANCE } from '../../content/balance';
import { type Atlas, AtlasCache, appearanceFor, makeTexture } from './AtlasCache';
import { ANIM_FALLBACK, frameAt, frameRect, pickView, type ViewId } from './manifest';
import { buildTerrainGeometry, exteriorTreePositions, treePositions, WATER_LEVEL } from './terrainMesh';
import { loadSheet, ValleyBackdrop } from './valleyBackdrop';
import groundSheetUrl from '../../../../assets/generated/sprites/Nuevos/Entorno/suelo_lozas.png';
import treeSheetUrl from '../../../../assets/generated/sprites/Nuevos/Entorno/arboles.png';
import kiCargaUrl from '../../../../assets/generated/sprites/Nuevos/Goku/ki_carga.png';
import kiDisparoUrl from '../../../../assets/generated/sprites/Nuevos/Goku/ki_disparo.png';
import kameHazUrl from '../../../../assets/generated/sprites/Nuevos/Goku/kamehameha_haz.png';
import kamePuntaUrl from '../../../../assets/generated/sprites/Nuevos/Goku/kamehameha_punta.png';
import kaiokenUrl from '../../../../assets/generated/sprites/Nuevos/Goku/kaioken_aura.png';
import teleportUrl from '../../../../assets/generated/sprites/Nuevos/Goku/teletransporte.png';
import kienzanUrl from '../../../../assets/generated/sprites/Nuevos/Goku/kienzan.png';
import taiyokenUrl from '../../../../assets/generated/sprites/Nuevos/Goku/taiyoken.png';
import sokidanUrl from '../../../../assets/generated/sprites/Nuevos/Goku/sokidan.png';
import lampUrl from '../../../../assets/generated/sprites/Nuevos/Goku/iluminaria.png';
import arenaUrl from '../../../../assets/generated/sprites/Nuevos/Goku/arena_suelo.png';
import itemsUrl from '../../../../assets/generated/sprites/Nuevos/Entorno/objetos.png';
import { DIGIT_ROW_Y, FX, FX_COLS, FX_ROWS, generateEffects, generateForestFloor, generateProps, generateTerrainAtlas, generateTrees, generateWater, PROP_CELLS, VALLEY_PALETTE } from './worldArt';
import { GRADE_UNIFORMS, patchWorld, uploadWorldLights, type WorldLight } from './worldGrade';

/** Glows sitting on the painted panes: capsule porthole, dojo grids, round window and annex. */
const WINDOW_LIGHTS: WorldLight[] = [
  { x: 7 + Math.sin(0.26 * Math.PI * 2) * 1.58, y: 1, z: 5.5 + Math.cos(0.26 * Math.PI * 2) * 1.58, radius: 2.4 },
  { x: 13.92, y: 1.08, z: 6.78, radius: 2.2 },
  { x: 17.08, y: 1.08, z: 6.78, radius: 2.2 },
  { x: 13.92, y: 1.08, z: 4.22, radius: 2.2 },
  { x: 17.08, y: 1.08, z: 4.22, radius: 2.2 },
  { x: 6 + Math.sin(0.78 * Math.PI * 2) * 1.48, y: 0.93, z: 12.5 + Math.cos(0.78 * Math.PI * 2) * 1.48, radius: 2.3 },
  { x: 7.51, y: 0.66, z: 13.28, radius: 2 },
];

interface Beam {
  mesh: THREE.Mesh;
  head: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  length: number;
  width: number;
  age: number;
  life: number;
}

const WHITE = new THREE.Color(1, 1, 1);

const PROJECTILE_FRAMES: Record<ProjectileVisual, readonly number[]> = {
  ki_ball: FX.kiBall,
  ki_wave: FX.kiWave,
  ki_charged: FX.kiCharged,
  kienzan: FX.disc,
  sokidan: FX.orb,
  kakusan: [FX.scatter, FX.scatter],
};

const BATTLE_STATES = new Set(['ENCOUNTER_TRANSITION', 'ACTIVE_COMBAT', 'COMBAT_VICTORY', 'COMBAT_DEFEAT']);

/** Unit quad with its origin at the bottom-center (feet pivot). */
function makeQuad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 1, 0, 0.5, 1, 0, -0.5, 0, 0, 0.5, 0, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
  g.setIndex([0, 2, 1, 2, 3, 1]);
  return g;
}

function makeCenteredQuad(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  return g;
}

/** Black ellipse. softness 0 keeps a hard disc; 1 spreads the edge across the whole quad. */
function shadowTexture(softness: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return tex;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * (0.08 + (1 - softness) * 0.28), size / 2, size / 2, size * 0.48);
  g.addColorStop(0, 'rgba(0,0,0,0.72)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.needsUpdate = true;
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return tex;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.48);
  g.addColorStop(0, 'rgba(255,214,140,0.55)');
  g.addColorStop(0.45, 'rgba(255,170,70,0.22)');
  g.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.needsUpdate = true;
  return tex;
}

interface PaintFrame {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface PaintStrip {
  tex: THREE.Texture;
  frames: PaintFrame[];
  /** One continuous band: scroll U instead of stepping columns. */
  scroll: boolean;
}

const LAMP_VIEWS: ViewId[] = ['S', 'SE', 'E', 'NE', 'N'];

/** Painted pickup sheet: 4×4 cells. The cracked rock occupies the bottom-left 2×2. */
const ITEM_COLS = 4;
const ITEM_ROWS = 4;
const ITEM_CELLS: Record<string, { c: number; r: number; w: number; h: number }> = {
  herb: { c: 0, r: 0, w: 1, h: 1 },
  ki_capsule: { c: 1, r: 0, w: 1, h: 1 },
  training_stone: { c: 2, r: 0, w: 1, h: 1 },
  iron_wristbands: { c: 3, r: 0, w: 1, h: 1 },
  reinforced_gi: { c: 0, r: 1, w: 1, h: 1 },
  focus_amulet: { c: 1, r: 1, w: 1, h: 1 },
  shrine_key: { c: 2, r: 1, w: 1, h: 1 },
  ancient_relic: { c: 3, r: 1, w: 1, h: 1 },
  sprout_fiber: { c: 2, r: 2, w: 1, h: 1 },
  rock_shard: { c: 3, r: 2, w: 1, h: 1 },
  valley_crystal: { c: 2, r: 3, w: 1, h: 1 },
  boulder: { c: 0, r: 2, w: 2, h: 2 },
};
const CRYSTAL_BRIGHT = { c: 3, r: 3, w: 1, h: 1 };

function itemUv(cell: { c: number; r: number; w: number; h: number }): { u0: number; v0: number; u1: number; v1: number } {
  return {
    u0: cell.c / ITEM_COLS,
    u1: (cell.c + cell.w) / ITEM_COLS,
    v1: 1 - cell.r / ITEM_ROWS,
    v0: 1 - (cell.r + cell.h) / ITEM_ROWS,
  };
}

function frameAspect(tex: THREE.Texture, fr: PaintFrame): number {
  const img = tex.image as { width?: number; height?: number } | undefined;
  const pw = (fr.u1 - fr.u0) * (img?.width ?? 1);
  const ph = (fr.v1 - fr.v0) * (img?.height ?? 1);
  return pw / Math.max(1, ph);
}

function setUv(g: THREE.BufferGeometry, u0: number, v0: number, u1: number, v1: number, mirror: boolean): void {
  const a = g.getAttribute('uv') as THREE.BufferAttribute;
  const L = mirror ? u1 : u0;
  const R = mirror ? u0 : u1;
  a.setXY(0, L, v1);
  a.setXY(1, R, v1);
  a.setXY(2, L, v0);
  a.setXY(3, R, v0);
  a.needsUpdate = true;
}

/** Splits a horizontal sheet into frames by empty columns. A single full-width band scrolls. */
function measureStrip(img: HTMLImageElement | null, expected: number): { frames: PaintFrame[]; scroll: boolean } {
  const even = (n: number): PaintFrame[] => Array.from({ length: n }, (_, i) => ({ u0: i / n, v0: 0, u1: (i + 1) / n, v1: 1 }));
  if (!img || typeof document === 'undefined') return { frames: even(expected), scroll: false };
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { frames: even(expected), scroll: false };
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const solid = (x: number, y: number): boolean => {
    const i = (y * canvas.width + x) * 4;
    return data[i + 3] > 24;
  };
  const cols: boolean[] = [];
  for (let x = 0; x < canvas.width; x++) {
    let on = false;
    for (let y = 0; y < canvas.height; y += 2) {
      if (solid(x, y)) {
        on = true;
        break;
      }
    }
    cols.push(on);
  }
  const runs: { a: number; b: number }[] = [];
  let start = -1;
  for (let x = 0; x <= canvas.width; x++) {
    if (x < canvas.width && cols[x]) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      if (x - start > 8) runs.push({ a: start, b: x });
      start = -1;
    }
  }
  const crop = (x0: number, x1: number): PaintFrame | null => {
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = x0; x < x1; x++) {
        if (!solid(x, y)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    const pad = 1;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(canvas.width - 1, maxX + pad);
    maxY = Math.min(canvas.height - 1, maxY + pad);
    return {
      u0: minX / canvas.width,
      u1: (maxX + 1) / canvas.width,
      v1: 1 - minY / canvas.height,
      v0: 1 - (maxY + 1) / canvas.height,
    };
  };
  if (runs.length <= 1) {
    const box = crop(0, canvas.width);
    if (!box) return { frames: even(expected), scroll: false };
    const tall = box.v1 - box.v0 < 0.55 && box.u1 - box.u0 > 0.75;
    return { frames: [box], scroll: tall };
  }
  // A ring or a burst has holes, so one frame becomes several runs. Cut equal columns then.
  const slices = runs.length === expected ? runs : Array.from({ length: expected }, (_, i) => ({ a: Math.floor((i * canvas.width) / expected), b: Math.floor(((i + 1) * canvas.width) / expected) }));
  const frames = slices.map((run) => crop(run.a, run.b)).filter((b): b is PaintFrame => b !== null);
  return { frames: frames.length > 0 ? frames : even(expected), scroll: false };
}

function measureTrees(img: HTMLImageElement): { u0: number; v0: number; u1: number; v1: number; h: number; aspect: number }[] {
  const fallback = [
    { u0: 0, v0: 0, u1: 0.25, v1: 1, h: 1, aspect: 0.9 },
    { u0: 0.25, v0: 0, u1: 0.5, v1: 1, h: 1, aspect: 0.55 },
    { u0: 0.5, v0: 0, u1: 0.75, v1: 1, h: 0.95, aspect: 1 },
    { u0: 0.75, v0: 0, u1: 1, v1: 1, h: 0.62, aspect: 0.7 },
  ];
  if (typeof document === 'undefined') return fallback;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const solid = (x: number, y: number) => {
    const i = (y * canvas.width + x) * 4;
    return data[i + 3] > 24 && (data[i] > 36 || data[i + 1] > 36 || data[i + 2] > 36);
  };
  const cols: boolean[] = [];
  for (let x = 0; x < canvas.width; x++) {
    let on = false;
    for (let y = 0; y < canvas.height; y += 2) {
      if (solid(x, y)) {
        on = true;
        break;
      }
    }
    cols.push(on);
  }
  const runs: { a: number; b: number }[] = [];
  let start = -1;
  for (let x = 0; x <= cols.length; x++) {
    if (x < cols.length && cols[x]) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      if (x - start > 8) runs.push({ a: start, b: x });
      start = -1;
    }
  }
  const boxes = runs.slice(0, 4).map((run) => {
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = run.a; x < run.b; x++) {
        if (!solid(x, y)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    return {
      u0: minX / canvas.width,
      u1: (maxX + 1) / canvas.width,
      v1: 1 - minY / canvas.height,
      v0: 1 - (maxY + 1) / canvas.height,
      w,
      h,
    };
  }).filter((b): b is NonNullable<typeof b> => b !== null);
  if (boxes.length === 0) return fallback;
  const tallest = Math.max(...boxes.map((b) => b.h));
  const out = boxes.map((b) => ({
    u0: b.u0,
    v0: b.v0,
    u1: b.u1,
    v1: b.v1,
    h: b.h / tallest,
    aspect: b.w / b.h,
  }));
  while (out.length < 4) out.push(out[out.length - 1]);
  return out.slice(0, 4);
}

interface SpriteView {
  root: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  shadow: THREE.Mesh;
  glow: THREE.Mesh;
  aura: THREE.Mesh | null;
  auraMat: THREE.MeshBasicMaterial | null;
  alert: THREE.Mesh | null;
  atlasKey: string;
  kind: 'char' | 'prop';
}

interface Fx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  frames: readonly number[] | number;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  grow: number;
  digit: number;
  ground: boolean;
  strip: PaintFrame[] | null;
}

export interface RendererOptions {
  mobile: boolean;
}

/**
 * Three.js view of the simulation. Shared by web (WebGL canvas) and native
 * (expo-gl) through React Three Fiber; it only reads game state and never
 * feeds back into gameplay.
 */
export class GameRenderer {
  private atlases = new AtlasCache();
  private views = new Map<number, SpriteView>();
  private projViews = new Map<number, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; frames: readonly number[]; glow: THREE.Mesh }>();
  private terrain: THREE.Mesh | null = null;
  private water: THREE.Mesh;
  private waterTex: THREE.Texture;
  private trees: THREE.InstancedMesh[] = [];
  private treeShadows: THREE.InstancedMesh | null = null;
  private treeData: { x: number; z: number; variant: number; size: number }[] = [];
  private shadowTex: THREE.CanvasTexture;
  private shadowMat: THREE.MeshBasicMaterial;
  private glowTex: THREE.CanvasTexture;
  private houseShadows: THREE.Mesh[] = [];
  private lamps: { x: number; z: number; pole: THREE.Mesh; bulb: THREE.Mesh; pool: THREE.Mesh; post: THREE.Mesh | null }[] = [];
  /** Ki volumes from the previous frame, so shadows can point away from them. */
  private kiLights: WorldLight[] = [];
  private pendingKi: WorldLight[] = [];
  private lampMat: THREE.MeshBasicMaterial | null = null;
  private arenaTex: THREE.Texture | null = null;
  private itemsTex: THREE.Texture | null = null;
  private arenaMesh: THREE.Mesh | null = null;
  private fxStrips: Partial<Record<'carga' | 'disparo' | 'haz' | 'punta' | 'kaioken' | 'teleport' | 'kienzan' | 'taiyoken' | 'sokidan' | 'lamp', PaintStrip>> = {};
  private windowPool: THREE.Mesh | null = null;
  private shadowSoft = -1;
  private propsTex: THREE.DataTexture;
  private fxTex: THREE.DataTexture;
  private terrainTex: THREE.DataTexture;
  private treeTex: THREE.DataTexture;
  private fxPool: Fx[] = [];
  private targetArrow: THREE.Mesh;
  private ctlRing: THREE.Mesh;
  private debugGroup = new THREE.Group();
  private debugSpheres: THREE.Mesh[] = [];
  private mapRef: unknown = null;
  private unsub: (() => void)[] = [];
  private tmpMat = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tiltQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private shadowEuler = new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ');
  private up = new THREE.Vector3(0, 1, 0);
  /** Billboard normal. A roll around it tilts the crown without skewing the sprite. */
  private face = new THREE.Vector3(0, 0, 1);
  private scratch = vec3();
  /** World clock (slowed by focus); drives water, props and effects. */
  private time = 0;
  /** Wrapped sway clock and a smoothed cross-wind, so crowns do not shiver. */
  private windPhase = 0;
  private swaySide = 0;
  private maxFx: number;
  private exterior: THREE.Mesh[] = [];
  private floorTex: THREE.DataTexture;
  private beams: Beam[] = [];
  private screenFlash = 0;
  private skyBase = new THREE.Color(VALLEY_PALETTE.sky);
  private dayTint = new THREE.Color();
  private backdrop: ValleyBackdrop;
  private paintedWater = false;
  private paintedTrees = false;
  private groundTex: THREE.Texture | null = null;
  private treeSheet: THREE.Texture | null = null;
  /** Tight bounds of the four painted trees, plus height relative to the tallest. */
  private treeShape: { u0: number; v0: number; u1: number; v1: number; h: number; aspect: number }[] = [
    { u0: 0, v0: 0, u1: 0.25, v1: 1, h: 1, aspect: 0.9 },
    { u0: 0.25, v0: 0, u1: 0.5, v1: 1, h: 1, aspect: 0.55 },
    { u0: 0.5, v0: 0, u1: 0.75, v1: 1, h: 0.95, aspect: 1 },
    { u0: 0.75, v0: 0, u1: 1, v1: 1, h: 0.62, aspect: 0.7 },
  ];
  private grey = new THREE.Color();
  private lowQuality: boolean;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private game: Game,
    opts: RendererOptions,
  ) {
    this.lowQuality = opts.mobile || game.settings.quality === 'low';
    this.maxFx = this.lowQuality ? 60 : 140;
    scene.background = new THREE.Color(VALLEY_PALETTE.sky);
    scene.fog = new THREE.Fog(VALLEY_PALETTE.sky, 30, 80);
    this.terrainTex = makeTexture(generateTerrainAtlas());
    this.treeTex = makeTexture(generateTrees());
    this.propsTex = makeTexture(generateProps());
    this.fxTex = makeTexture(generateEffects());
    this.waterTex = makeTexture(generateWater(), true);
    this.floorTex = makeTexture(generateForestFloor(), true);
    this.shadowTex = shadowTexture(game.day.shadowSoftness);
    this.shadowSoft = game.day.shadowSoftness;
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.5 });
    this.glowTex = glowTexture();

    // Water only exists inside the map (rivers); outside is forest ground.
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), patchWorld(new THREE.MeshBasicMaterial({ map: this.waterTex, color: 0xffffff })));
    this.water.rotation.x = -Math.PI / 2;
    scene.add(this.water);

    const fxMat = (): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ map: this.fxTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.targetArrow = new THREE.Mesh(makeCenteredQuad(), fxMat());
    this.setFxUv(this.targetArrow.geometry, FX.arrow);
    this.targetArrow.renderOrder = 10;
    scene.add(this.targetArrow);
    this.ctlRing = new THREE.Mesh(makeCenteredQuad(), fxMat());
    (this.ctlRing.material as THREE.MeshBasicMaterial).color.set(0x8affc8);
    this.setFxUv(this.ctlRing.geometry, FX.ring);
    this.ctlRing.rotation.x = -Math.PI / 2;
    scene.add(this.ctlRing);
    scene.add(this.debugGroup);
    this.backdrop = new ValleyBackdrop(scene);
    void this.loadPaintedValley();

    for (let i = 0; i < this.maxFx; i++) {
      const mat = patchWorld(fxMat());
      const mesh = new THREE.Mesh(makeCenteredQuad(), mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.fxPool.push({ mesh, mat, active: false, frames: 0, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, digit: -1, ground: false, strip: null });
    }
    this.subscribe();
  }

  private async loadPaintedValley(): Promise<void> {
    try {
      const sheets = await Promise.all([
        loadSheet(groundSheetUrl, false),
        loadSheet(treeSheetUrl, false),
        loadSheet(arenaUrl, false),
        loadSheet(kiCargaUrl, false),
        loadSheet(kiDisparoUrl, false),
        loadSheet(kameHazUrl, false),
        loadSheet(kamePuntaUrl, false),
        loadSheet(kaiokenUrl, false),
        loadSheet(teleportUrl, false),
        loadSheet(kienzanUrl, false),
        loadSheet(taiyokenUrl, false),
        loadSheet(sokidanUrl, false),
        loadSheet(lampUrl, false),
        loadSheet(itemsUrl, false),
      ]);
      const [ground, trees, arena, carga, disparo, haz, punta, kaioken, teleport, kienzan, taiyoken, sokidan, lamp, items] = sheets;
      if (ground) this.groundTex = ground.tex;
      if (trees?.img) {
        this.treeSheet = trees.tex;
        this.treeShape = measureTrees(trees.img);
        this.paintedTrees = false;
      }
      if (arena) this.arenaTex = arena.tex;
      if (items) this.itemsTex = items.tex;
      const take = (sheet: { tex: THREE.Texture; img: HTMLImageElement | null } | null, frames: number, scrollOk: boolean): PaintStrip | undefined => {
        if (!sheet) return undefined;
        const measured = measureStrip(sheet.img, frames);
        const strip: PaintStrip = { tex: sheet.tex, frames: measured.frames, scroll: scrollOk && measured.scroll };
        if (strip.scroll) {
          strip.tex.wrapS = THREE.RepeatWrapping;
          strip.tex.needsUpdate = true;
        }
        return strip;
      };
      this.fxStrips = {
        carga: take(carga, 4, false),
        disparo: take(disparo, 4, false),
        haz: take(haz, 4, true),
        punta: take(punta, 4, false),
        kaioken: take(kaioken, 4, false),
        teleport: take(teleport, 4, false),
        kienzan: take(kienzan, 4, false),
        taiyoken: take(taiyoken, 4, false),
        sokidan: take(sokidan, 4, false),
        lamp: take(lamp, 5, false),
      };
      const lampStrip = this.fxStrips.lamp;
      if (lampStrip) {
        this.lampMat = new THREE.MeshBasicMaterial({
          map: lampStrip.tex,
          alphaTest: 0.5,
          depthWrite: true,
          fog: false,
        });
      }
      // Rebuild on the next frame so the court, the lamps and the ground use the sheets together.
      this.mapRef = null;
    } catch (err) {
      console.warn('No se pudo cargar el suelo, los efectos y las luminarias pintados.', err);
    }
  }

  private buildMap(): void {
    const map = this.game.map;
    if (this.mapRef === map) return;
    this.mapRef = map;
    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.terrain.geometry.dispose();
    }
    for (const t of this.trees) {
      this.scene.remove(t);
      t.dispose();
    }
    if (this.treeShadows) {
      this.scene.remove(this.treeShadows);
      this.treeShadows.geometry.dispose();
      this.treeShadows = null;
    }
    for (const m of this.houseShadows) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.houseShadows = [];
    for (const lamp of this.lamps) {
      for (const part of [lamp.pole, lamp.bulb, lamp.pool]) {
        this.scene.remove(part);
        part.geometry.dispose();
        (part.material as THREE.Material).dispose();
      }
      if (lamp.post) {
        this.scene.remove(lamp.post);
        lamp.post.geometry.dispose();
      }
    }
    this.lamps = [];
    if (this.arenaMesh) {
      this.scene.remove(this.arenaMesh);
      this.arenaMesh.geometry.dispose();
      (this.arenaMesh.material as THREE.Material).dispose();
      this.arenaMesh = null;
    }
    if (this.windowPool) {
      this.scene.remove(this.windowPool);
      this.windowPool.geometry.dispose();
      (this.windowPool.material as THREE.Material).dispose();
      this.windowPool = null;
    }
    for (const m of this.exterior) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    const tiles = map.tiles;
    this.terrain = new THREE.Mesh(
      buildTerrainGeometry(tiles, this.groundTex !== null, this.arenaTex !== null),
      patchWorld(new THREE.MeshBasicMaterial({ map: this.groundTex ?? this.terrainTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })),
    );
    this.scene.add(this.terrain);
    if (this.arenaTex) {
      this.arenaMesh = new THREE.Mesh(
        buildTerrainGeometry(tiles, true, 'only'),
        patchWorld(new THREE.MeshBasicMaterial({ map: this.arenaTex, vertexColors: true, side: THREE.DoubleSide })),
      );
      this.arenaMesh.position.y = 0.02;
      this.scene.add(this.arenaMesh);
    }
    this.water.scale.set(tiles.width, tiles.height, 1);
    this.water.position.set(tiles.width / 2, WATER_LEVEL, tiles.height / 2);
    this.waterTex.repeat.set(tiles.width / 2, tiles.height / 2);

    // Exterior: a frame of forest floor around the map (never the sky colour or open water).
    const E = 90;
    const W = tiles.width;
    const H = tiles.height;
    const floorMat = patchWorld(new THREE.MeshBasicMaterial({ map: this.floorTex }));
    const frame: [number, number, number, number][] = [
      [-E, -E, W + E, 0],
      [-E, H, W + E, H + E],
      [-E, 0, 0, H],
      [W, 0, W + E, H],
    ];
    this.exterior = frame.map(([x0, z0, x1, z1]) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / 2, (uv.getY(i) * (z1 - z0)) / 2);
      const m = new THREE.Mesh(g, floorMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, -0.01, (z0 + z1) / 2);
      this.scene.add(m);
      return m;
    });

    this.paintedTrees = false;
    this.backdrop.dressMap(tiles);
    this.treeData = [...treePositions(tiles), ...exteriorTreePositions(tiles, this.lowQuality ? 5 : 7, this.lowQuality ? 1.8 : 1.45)];
    this.trees = [0, 1, 2, 3].map((variant) => {
      const count = this.treeData.filter((t) => t.variant === variant).length;
      const g = makeQuad();
      const shape = this.treeShape[variant];
      setUv(g, shape.u0, shape.v0, shape.u1, shape.v1, false);
      const m = new THREE.InstancedMesh(g, patchWorld(new THREE.MeshBasicMaterial({ map: this.treeTex, alphaTest: 0.5 })), Math.max(1, count));
      m.count = count;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    });
    const shade = new THREE.InstancedMesh(makeCenteredQuad(), this.shadowMat, Math.max(1, this.treeData.length));
    shade.count = this.treeData.length;
    shade.frustumCulled = false;
    shade.renderOrder = 1;
    this.scene.add(shade);
    this.treeShadows = shade;
    const houseFoot: { x: number; z: number; w: number; d: number }[] = [
      { x: 7, z: 5.5, w: 3.2, d: 3.2 },
      { x: 15.5, z: 5.5, w: 4.6, d: 2.8 },
      { x: 6, z: 12.5, w: 3.4, d: 3.4 },
    ];
    this.houseShadows = houseFoot.map((h) => {
      const mesh = new THREE.Mesh(makeCenteredQuad(), this.shadowMat);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.04;
      mesh.renderOrder = 1;
      mesh.userData.w = h.w;
      mesh.userData.d = h.d;
      mesh.userData.x = h.x;
      mesh.userData.z = h.z;
      this.scene.add(mesh);
      return mesh;
    });
    this.lamps = map.lamps.map((lamp) => this.addLamp(lamp.x, lamp.z));
    this.windowPool = this.lightPool(7.55, 13.15);
  }

  private lightPool(x: number, z: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      map: this.glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      color: 0xffcc88,
    });
    const mesh = new THREE.Mesh(makeCenteredQuad(), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05, z);
    mesh.renderOrder = 2;
    mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  /** Painted capsule lamp when the sheet is loaded; otherwise a simple post. The pool lights the ground. */
  private addLamp(x: number, z: number): { x: number; z: number; pole: THREE.Mesh; bulb: THREE.Mesh; pool: THREE.Mesh; post: THREE.Mesh | null } {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 1.7, 6),
      new THREE.MeshBasicMaterial({ color: 0x3a3e48, fog: false }),
    );
    pole.position.set(x, 0.85, z);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe2a8, fog: false }),
    );
    bulb.position.set(x, 1.75, z);
    const pool = this.lightPool(x, z);
    this.scene.add(pole, bulb);
    let post: THREE.Mesh | null = null;
    const strip = this.fxStrips.lamp;
    const fr = strip?.frames[0];
    if (strip && fr && this.lampMat) {
      post = new THREE.Mesh(makeQuad(), this.lampMat);
      post.position.set(x, 0, z);
      const height = 2.35;
      post.scale.set(height * frameAspect(strip.tex, fr), height, 1);
      pole.visible = false;
      bulb.visible = false;
      this.scene.add(post);
    }
    return { x, z, pole, bulb, pool, post };
  }

  /**
   * Direction the shadow is pushed. Points toward the dominant light (sun, lamp or window),
   * so the blob lands on the opposite side. `vis` is 0 when nothing is casting.
   */
  private castDir(x: number, z: number): { x: number; z: number; vis: number; reach: number } {
    const day = this.game.day;
    const sunVis = Math.min(1, Math.max(0, day.elevation * 1.35));
    const sunW = sunVis * (1 - day.night);
    let dirX = day.sunX * sunW;
    let dirZ = day.sunZ * sunW;
    let lampW = 0;
    let lampDist = day.lampRadius;
    const consider = (lx: number, lz: number, radius: number, gain: number): void => {
      if (radius < 0.25 || gain < 0.02) return;
      const dx = lx - x;
      const dz = lz - z;
      const dist = Math.hypot(dx, dz);
      if (dist > radius) return;
      const w = (1 - dist / radius) * gain;
      if (w <= lampW) return;
      lampW = w;
      lampDist = dist;
      const len = dist || 1;
      dirX = day.sunX * sunW + (dx / len) * w;
      dirZ = day.sunZ * sunW + (dz / len) * w;
    };
    const lit = Math.min(1.4, day.lampsOn * day.lightBrightness);
    for (const lamp of this.lamps) consider(lamp.x, lamp.z, day.lampRadius * lit, 1);
    for (const win of WINDOW_LIGHTS) consider(win.x, win.z, win.radius * lit, 1);
    for (const ki of this.kiLights) consider(ki.x, ki.z, ki.radius, 1);
    const len = Math.hypot(dirX, dirZ) || 1;
    const vis = Math.min(1, Math.max(sunW, lampW));
    const sunReach = 0.35 + 2.4 * (1 - Math.max(0, day.elevation));
    const nearReach = 0.28 + Math.min(2.4, lampDist * 0.42);
    return { x: dirX / len, z: dirZ / len, vis, reach: lampW > sunW ? nearReach : sunReach };
  }

  /**
   * Billboard trees face the camera. Trees standing in the strip just in
   * front of the camera (below the bottom of the screen, or barely above it)
   * are cut away: stretched for the pitch, they would otherwise cover half
   * the view at the map edges.
   */
  private updateTrees(yaw: number, stretch: number, dt: number): void {
    const rig = this.game.camera;
    const cx = rig.position.x;
    const cz = rig.position.z;
    const p = rig.pose;
    const camH = Math.max(0.5, rig.position.y - rig.lookAt.y);
    const bottomRay = Math.min(p.pitch + (p.fov * Math.PI) / 360, Math.PI / 2 - 0.02);
    const cut = camH / Math.tan(bottomRay) + BALANCE.render.treeCutaway;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const wind = this.game.wind;
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const targetSide = wind.dirX * rightX + wind.dirZ * rightZ;
    const follow = 1 - Math.exp(-Math.max(0, dt) * 0.55);
    this.swaySide += (targetSide - this.swaySide) * follow;
    this.windPhase = (this.windPhase + Math.max(0, dt) * 0.55) % (Math.PI * 2);
    const counters = [0, 0, 0, 0];
    for (const t of this.treeData) {
      const ahead = (t.x - cx) * fx + (t.z - cz) * fz;
      this.tmpV.set(t.x, 0, t.z);
      const shape = this.treeShape[t.variant] ?? this.treeShape[0];
      if (ahead < cut) this.tmpS.set(0, 0, 0);
      else {
        const h = 3.5 * t.size * shape.h * stretch;
        this.tmpS.set(h * shape.aspect, h, 1);
      }
      const phase = (t.x * 0.23 + t.z * 0.17) % (Math.PI * 2);
      const sway = 0.78 + 0.22 * Math.sin(this.windPhase + phase);
      // Negative roll sends the crown toward camera-right when the wind blows that way.
      const angle = -BALANCE.wind.treeLean * wind.strength * sway * this.swaySide;
      this.tiltQ.setFromAxisAngle(this.face, angle);
      this.tmpQ.setFromAxisAngle(this.up, yaw).multiply(this.tiltQ);
      this.tmpMat.compose(this.tmpV, this.tmpQ, this.tmpS);
      this.trees[t.variant].setMatrixAt(counters[t.variant]++, this.tmpMat);
    }
    for (const m of this.trees) m.instanceMatrix.needsUpdate = true;
    this.placeTreeShadows();
  }

  private placeTreeShadows(): void {
    const mesh = this.treeShadows;
    if (!mesh) return;
    const soft = 1 + this.game.day.shadowSoftness * 0.85;
    this.treeData.forEach((t, i) => {
      const cast = this.castDir(t.x, t.z);
      this.shadowEuler.y = Math.atan2(cast.x, cast.z);
      this.tmpQ.setFromEuler(this.shadowEuler);
      const len = t.size * cast.reach;
      const show = cast.vis > 0.04 ? 1 : 0;
      this.tmpV.set(t.x - cast.x * len * 0.55, 0.04, t.z - cast.z * len * 0.55);
      this.tmpS.set(t.size * 1.35 * soft * show, len * 1.5 * soft * show, 1);
      this.tmpMat.compose(this.tmpV, this.tmpQ, this.tmpS);
      mesh.setMatrixAt(i, this.tmpMat);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  private setFxUv(g: THREE.BufferGeometry, cell: number): void {
    const cw = 32 / (FX_COLS * 32);
    const totalH = FX_ROWS * 32 + 10;
    const ch = 32 / totalH;
    const cx = cell % FX_COLS;
    const cy = Math.floor(cell / FX_COLS);
    const v1 = 1 - cy * ch;
    const v0 = 1 - (cy + 1) * ch;
    const a = g.getAttribute('uv') as THREE.BufferAttribute;
    a.setXY(0, cx * cw, v1);
    a.setXY(1, (cx + 1) * cw, v1);
    a.setXY(2, cx * cw, v0);
    a.setXY(3, (cx + 1) * cw, v0);
    a.needsUpdate = true;
  }

  private setDigitUv(g: THREE.BufferGeometry, d: number): void {
    const W = FX_COLS * 32;
    const H = FX_ROWS * 32 + 10;
    const u0 = (d * 8) / W;
    const u1 = (d * 8 + 7) / W;
    const v1 = 1 - DIGIT_ROW_Y / H;
    const v0 = 1 - (DIGIT_ROW_Y + 9) / H;
    const a = g.getAttribute('uv') as THREE.BufferAttribute;
    a.setXY(0, u0, v1);
    a.setXY(1, u1, v1);
    a.setXY(2, u0, v0);
    a.setXY(3, u1, v0);
    a.needsUpdate = true;
  }

  // ------------------------------------------------------------ effects

  private spawnFx(frames: readonly number[] | number, x: number, y: number, z: number, opts: Partial<Pick<Fx, 'life' | 'size' | 'vx' | 'vy' | 'vz' | 'grow' | 'ground'>> & { color?: number; digit?: number; additive?: boolean; paint?: PaintStrip } = {}): void {
    const fx = this.fxPool.find((f) => !f.active);
    if (!fx) return;
    fx.active = true;
    fx.frames = frames;
    fx.age = 0;
    fx.life = opts.life ?? 0.35;
    fx.x = x;
    fx.y = y;
    fx.z = z;
    fx.vx = opts.vx ?? 0;
    fx.vy = opts.vy ?? 0;
    fx.vz = opts.vz ?? 0;
    fx.size = opts.size ?? 1;
    fx.grow = opts.grow ?? 0;
    fx.ground = opts.ground ?? false;
    fx.digit = opts.digit ?? -1;
    fx.strip = opts.paint?.frames ?? null;
    fx.mat.color.set(opts.paint ? 0xffffff : (opts.color ?? 0xffffff));
    fx.mat.blending = opts.paint || opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
    fx.mat.alphaTest = opts.paint ? 0.12 : 0;
    fx.mat.opacity = 1;
    if (opts.paint) fx.mat.map = opts.paint.tex;
    else if (fx.mat.map !== this.fxTex) fx.mat.map = this.fxTex;
    fx.mat.needsUpdate = true;
    fx.mesh.visible = true;
    fx.mesh.rotation.set(fx.ground ? -Math.PI / 2 : 0, 0, 0);
    if (opts.paint?.frames[0]) {
      const fr = opts.paint.frames[0];
      setUv(fx.mesh.geometry, fr.u0, fr.v0, fr.u1, fr.v1, false);
    } else if (fx.digit >= 0) this.setDigitUv(fx.mesh.geometry, fx.digit);
    else this.setFxUv(fx.mesh.geometry, typeof frames === 'number' ? frames : frames[0]);
  }

  private damageNumber(n: number, x: number, y: number, z: number, color: number): void {
    const s = String(Math.max(0, Math.round(n)));
    const yaw = this.game.camera.pose.yaw;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    for (let i = 0; i < s.length; i++) {
      const off = (i - (s.length - 1) / 2) * 0.28;
      this.spawnFx(0, x + rx * off, y + 0.4, z + rz * off, { digit: Number(s[i]), size: 0.34, vy: 1.6, life: 0.8, color, additive: false });
    }
  }

  private subscribe(): void {
    const ev = this.game.events;
    const flash = (): boolean => !this.game.settings.reduceFlashes;
    this.unsub.push(
      ev.on('hit', (h) => {
        const defender = this.game.world.get(h.defenderId);
        const onPlayer = defender?.combatant?.team === 'player';
        if (h.blocked) this.spawnFx(FX.shockwave, h.x, h.y, h.z, { size: 0.9, grow: 2, life: 0.25, color: 0x9ad8ff });
        else {
          this.spawnFx(FX.spark, h.x, h.y, h.z, { size: h.heavy ? 1.6 : 1, life: 0.22, color: flash() ? 0xffffff : 0xfff0c0 });
          if (h.heavy) this.spawnFx(FX.shockwave, h.x, h.y, h.z, { size: 0.6, grow: 4, life: 0.3, color: 0xfff07a });
        }
        this.damageNumber(h.damage, h.x, h.y, h.z, h.blocked ? 0xaaaaaa : h.crit ? 0xffe04a : onPlayer ? 0xff6a6a : 0xffffff);
        this.game.camera.addTrauma(h.heavy ? 0.32 : h.blocked ? 0.06 : 0.12);
      }),
      ev.on('parry', (p) => {
        this.spawnFx(FX.shockwave, p.x, p.y, p.z, { size: 1, grow: 5, life: 0.3, color: 0xffffff });
        this.spawnFx(FX.star, p.x, p.y + 0.4, p.z, { size: 0.8, vy: 1, life: 0.5, color: 0x8affff });
      }),
      ev.on('projectileExploded', (e) => this.spawnFx(FX.explosion, e.x, e.y, e.z, { size: e.visual === 'ki_wave' ? 2.2 : 1.2, life: 0.35 })),
      ev.on('dash', (d) => {
        const e = this.game.world.get(d.entityId);
        if (!e) return;
        const p = e.transform.pos;
        this.spawnFx(FX.dust, p.x, p.y + 0.2, p.z, { size: 1, life: 0.3, additive: false, color: 0xd8c8a8 });
        for (let i = 0; i < 3; i++) this.spawnFx(FX.streak, p.x, p.y + 0.5 + i * 0.35, p.z, { size: 1.2, life: 0.18, color: 0xffffff });
      }),
      ev.on('teleport', (t) => {
        const burst = this.fxStrips.teleport;
        const e = this.game.world.get(t.entityId);
        if (burst) {
          this.spawnFx(0, t.fromX, t.fromY + 0.9, t.fromZ, { size: 1.8, life: 0.45, paint: burst });
          if (e) this.spawnFx(0, e.transform.pos.x, e.transform.pos.y + 0.9, e.transform.pos.z, { size: 1.8, life: 0.45, paint: burst });
        } else {
          this.spawnFx(FX.shockwave, t.fromX, t.fromY + 0.8, t.fromZ, { size: 0.5, grow: 3, life: 0.2, color: 0xffffff });
          if (e) this.spawnFx(FX.shockwave, e.transform.pos.x, e.transform.pos.y + 0.8, e.transform.pos.z, { size: 1.6, grow: -4, life: 0.2, color: 0xffffff });
        }
      }),
      ev.on('meteoStart', (m) => {
        const e = this.game.world.get(m.attackerId);
        if (!e) return;
        const p = e.transform.pos;
        this.spawnFx(FX.shockwave, p.x, p.y + 0.8, p.z, { size: 1, grow: 10, life: 0.5, color: 0xfff07a });
        this.game.camera.addTrauma(0.4);
      }),
      ev.on('meteoHit', (m) => {
        this.spawnFx(FX.spark, m.x, m.y, m.z, { size: m.final ? 2.5 : 1.2, life: 0.25 });
        if (m.final) {
          this.spawnFx(FX.explosion, m.x, m.y, m.z, { size: 3, life: 0.5 });
          this.spawnFx(FX.shockwave, m.x, m.y, m.z, { size: 1, grow: 12, life: 0.45, color: 0xffffff });
          this.game.camera.addTrauma(0.9);
        } else this.game.camera.addTrauma(0.15);
      }),
      ev.on('levelUp', (l) => {
        const e = this.game.world.getStable(`hero_${l.characterId}`);
        if (!e) return;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          this.spawnFx(FX.star, e.transform.pos.x + Math.cos(a) * 0.5, e.transform.pos.y + 0.6, e.transform.pos.z + Math.sin(a) * 0.5, { size: 0.5, vy: 2, life: 0.9, color: 0xfff07a });
        }
      }),
      ev.on('obstacleBroken', (o) => {
        this.spawnFx(FX.explosion, o.x, 1, o.z, { size: 3, life: 0.5 });
        for (let i = 0; i < 5; i++) this.spawnFx(FX.dust, o.x + Math.cos(i) * 0.8, 0.4, o.z + Math.sin(i) * 0.8, { size: 1.4, life: 0.7, additive: false, color: 0xb8b0a0, vy: 0.6 });
      }),
      ev.on('defeated', (d) => {
        const e = this.game.world.get(d.entityId);
        if (e) this.spawnFx(FX.explosion, e.transform.pos.x, e.transform.pos.y + 0.8, e.transform.pos.z, { size: 1.4, life: 0.4 });
      }),
      ev.on('encounterStart', () => {
        const l = this.game.leader();
        this.spawnFx(FX.shockwave, l.transform.pos.x, l.transform.pos.y + 0.1, l.transform.pos.z, { size: 1, grow: 14, life: 0.6, ground: true, color: 0xffffff });
      }),
      ev.on('beamFired', (b) => {
        this.spawnBeam(b);
        this.spawnFx(FX.kiWave, b.x, b.y, b.z, { size: b.width * 3, grow: 1, life: 0.3, color: b.color });
      }),
      ev.on('flash', (f) => {
        this.screenFlash = 0.35;
        const sun = this.fxStrips.taiyoken;
        if (sun) this.spawnFx(0, f.x, f.y, f.z, { size: Math.max(2.4, f.radius * 0.5), life: 0.5, paint: sun });
        else this.spawnFx(FX.flash, f.x, f.y, f.z, { size: 1.2, grow: f.radius * 2.5, life: 0.35, color: 0xffffff });
      }),
      ev.on('blinded', (b) => {
        const e = this.game.world.get(b.entityId);
        if (!e) return;
        const p = e.transform.pos;
        for (let i = 0; i < 3; i++) this.spawnFx(FX.star, p.x + (i - 1) * 0.35, p.y + 1.9, p.z, { size: 0.35, vy: 0.4, life: 0.8, color: 0xffffff });
      }),
      ev.on('techniqueUsed', (t) => {
        const e = this.game.world.get(t.entityId);
        if (!e) return;
        const p = e.transform.pos;
        this.spawnFx(FX.shockwave, p.x, p.y + 0.05, p.z, { size: 0.6, grow: t.limit ? 9 : 5, life: 0.35, ground: true, color: t.limit ? 0xffd84a : (e.appearance?.palette.aura ?? 0xffffff) });
      }),
    );
  }

  // ------------------------------------------------------------ sprites

  private ensureView(e: Entity): SpriteView {
    let v = this.views.get(e.id);
    if (v) return v;
    const root = new THREE.Group();
    const mat = patchWorld(new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, depthWrite: false, map: this.propsTex }));
    const mesh = new THREE.Mesh(makeQuad(), mat);
    mesh.renderOrder = 3;
    root.add(mesh);
    const shadow = new THREE.Mesh(makeCenteredQuad(), this.shadowMat);
    shadow.rotation.order = 'YXZ';
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 1;
    this.scene.add(shadow);
    const glow = this.lightPool(0, 0);
    const isChar = !!appearanceFor(e.sprite!.atlas);
    let aura: THREE.Mesh | null = null;
    let auraMat: THREE.MeshBasicMaterial | null = null;
    let alert: THREE.Mesh | null = null;
    if (isChar) {
      auraMat = new THREE.MeshBasicMaterial({ map: this.fxTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: e.appearance?.palette.aura ?? 0xffffff });
      aura = new THREE.Mesh(makeQuad(), auraMat);
      aura.visible = false;
      aura.renderOrder = 2;
      const cwF = 32 / (FX_COLS * 32);
      const chF = 32 / (FX_ROWS * 32 + 10);
      const ac = FX.aura[0];
      setUv(aura.geometry, (ac % FX_COLS) * cwF, 1 - (Math.floor(ac / FX_COLS) + 1) * chF, (ac % FX_COLS + 1) * cwF, 1 - Math.floor(ac / FX_COLS) * chF, false);
      root.add(aura);
      if (e.explorer) {
        alert = new THREE.Mesh(makeCenteredQuad(), new THREE.MeshBasicMaterial({ map: this.fxTex, transparent: true, depthWrite: false }));
        this.setFxUv(alert.geometry, FX.alert);
        alert.visible = false;
        root.add(alert);
      }
      // Prefetch the battle atlas incrementally so encounters start without hitches.
      this.atlases.prefetch(e.sprite!.atlas, 'battle');
    }
    this.scene.add(root);
    v = { root, mesh, mat, shadow, glow, aura, auraMat, alert, atlasKey: '', kind: isChar ? 'char' : 'prop' };
    this.views.set(e.id, v);
    return v;
  }

  private removeView(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.root);
    this.scene.remove(v.shadow);
    this.scene.remove(v.glow);
    v.mesh.geometry.dispose();
    v.mat.dispose();
    v.shadow.geometry.dispose();
    v.glow.geometry.dispose();
    (v.glow.material as THREE.Material).dispose();
    v.aura?.geometry.dispose();
    v.auraMat?.dispose();
    this.views.delete(id);
  }

  /** Cell of objetos.png for a world prop. Null keeps the procedural icon (chests). */
  private paintedProp(atlas: string): { id: string; u0: number; v0: number; u1: number; v1: number; w: number; h: number; bob: boolean } | null {
    let id = '';
    let bob = false;
    if (atlas.startsWith('item:')) {
      id = atlas.slice(5);
      bob = true;
    } else if (atlas === 'prop:stone') {
      id = 'training_stone';
      bob = true;
    } else if (atlas === 'prop:pickup') {
      id = 'herb';
      bob = true;
    } else if (atlas === 'prop:crystal') id = 'valley_crystal';
    else if (atlas === 'prop:boulder') id = 'boulder';
    else return null;
    const bright = id === 'valley_crystal' && Math.floor(this.time * 2) % 2 === 1;
    const cell = bright ? CRYSTAL_BRIGHT : ITEM_CELLS[id];
    if (!cell) return null;
    return { id: bright ? `${id}:b` : id, ...itemUv(cell), w: cell.w, h: cell.h, bob };
  }

  private propCell(e: Entity): number {
    const s = e.sprite!;
    switch (s.atlas) {
      case 'prop:chest':
        return s.anim === 'interact' ? PROP_CELLS.chestOpen : PROP_CELLS.chest;
      case 'prop:pickup':
        return PROP_CELLS.pickup;
      case 'prop:stone':
        return PROP_CELLS.stone;
      case 'prop:crystal':
        return Math.floor(this.time * 2) % 2 ? PROP_CELLS.crystalB : PROP_CELLS.crystalA;
      case 'prop:boulder':
        return PROP_CELLS.boulder;
      default:
        return PROP_CELLS.pickup;
    }
  }

  private syncSprite(e: Entity, alpha: number, camYaw: number, stretch: number, battle: boolean): void {
    const v = this.ensureView(e);
    const s = e.sprite!;
    const t = e.transform;
    const x = t.prev.x + (t.pos.x - t.prev.x) * alpha;
    const y = t.prev.y + (t.pos.y - t.prev.y) * alpha;
    const z = t.prev.z + (t.pos.z - t.prev.z) * alpha;
    v.root.position.set(x, y, z);
    v.root.rotation.y = camYaw;
    v.root.visible = s.visible && s.alpha > 0.02;
    const ground = this.game.map.tiles.visualHeightAt(x, z);
    const above = Math.max(0, y - ground);
    const shadowSize = (e.body ? e.body.radius * 3 : 0.9) * Math.max(0.35, 1 - above * 0.12);
    const day = this.game.day;
    const cast = this.castDir(x, z);
    const soft = 1 + day.shadowSoftness * 0.9;
    const width = shadowSize * 0.72 * soft;
    // Local +Y of the flat quad points away from the light (opposite atan2(cast)).
    const length = width * (1.7 + Math.min(1.4, cast.reach * 0.85));
    const tuck = width * 0.55;
    const shift = Math.max(0, length * 0.5 - tuck);
    v.shadow.position.set(x - cast.x * shift, Math.max(ground, WATER_LEVEL) + 0.03, z - cast.z * shift);
    v.shadow.rotation.y = Math.atan2(cast.x, cast.z);
    v.shadow.scale.set(width, length, 1);
    v.shadow.visible = v.root.visible && cast.vis > 0.04;
    const ki = v.kind === 'char' && (s.anim === 'charge' || s.anim === 'kiblast' || s.anim === 'special' || s.anim.startsWith('tech_') || s.aura);
    v.glow.visible = ki && v.root.visible;
    if (v.glow.visible) {
      const pool = (s.anim === 'charge' ? 2.4 : 1.6) * day.lightBrightness * (0.7 + 0.8 * day.night);
      v.glow.position.set(x, Math.max(ground, WATER_LEVEL) + 0.06, z);
      v.glow.scale.set(pool, pool, 1);
      (v.glow.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 0.35 + 0.65 * day.night) * day.lightBrightness;
      this.pendingKi.push({ x, y: y + 1, z, radius: pool * 0.7 });
    }

    if (v.kind === 'prop') {
      const painted = this.paintedProp(s.atlas);
      if (painted && this.itemsTex) {
        const key = `item:${painted.id}`;
        if (v.atlasKey !== key) {
          v.atlasKey = key;
          if (v.mat.map !== this.itemsTex) {
            v.mat.map = this.itemsTex;
            v.mat.needsUpdate = true;
          }
          setUv(v.mesh.geometry, painted.u0, painted.v0, painted.u1, painted.v1, false);
        }
        const size = painted.id.startsWith('boulder') ? 2.2 : painted.id.startsWith('valley_crystal') ? 1.3 : 0.9;
        v.mesh.scale.set(size * (painted.w / painted.h), size * Math.min(stretch, 1.6), 1);
        v.mesh.position.y = painted.bob ? 0.1 + Math.sin(this.time * 3 + e.id) * 0.08 : 0;
        return;
      }
      const cell = this.propCell(e);
      const key = `prop${cell}`;
      if (v.atlasKey !== key) {
        v.atlasKey = key;
        v.mat.map = this.propsTex;
        setUv(v.mesh.geometry, (cell * 32) / 256, 0, ((cell + 1) * 32) / 256, 1, false);
      }
      const size = s.atlas === 'prop:boulder' ? 2.2 : s.atlas === 'prop:crystal' ? 1.3 : 0.9;
      v.mesh.scale.set(size, size * Math.min(stretch, 1.6), 1);
      v.mesh.position.y = s.atlas === 'prop:pickup' || s.atlas === 'prop:stone' ? 0.1 + Math.sin(this.time * 3 + e.id) * 0.08 : 0;
      return;
    }

    const engagedBattle = battle && !!e.combatant?.engaged;
    const mode = engagedBattle ? 'battle' : 'world';
    const atlas: Atlas | null = this.atlases.get(s.atlas, mode);
    if (!atlas) return;
    const m = atlas.manifest;
    const fallback = ANIM_FALLBACK[s.anim];
    const anim = m.anims[s.anim] ? s.anim : fallback && m.anims[fallback] ? fallback : m.anims.idle ? 'idle' : (Object.keys(m.anims)[0] as typeof s.anim);
    const def = m.anims[anim]!;
    // Technique poses follow the simulation phase (prep / release / recovery) so the release frame matches the hit.
    const phase = anim === s.anim && s.anim.startsWith('tech_') ? s.phaseFrame : null;
    const frame = phase != null && phase < def.frames ? phase : frameAt(def, s.animTicks);
    // Directional billboard: travel direction while dashing/flying fast, otherwise facing.
    let facing = t.yaw;
    if (e.body && (s.anim === 'fly' || s.anim === 'dash' || s.anim === 'run' || s.anim === 'walk')) {
      const vx = e.body.vel.x;
      const vz = e.body.vel.z;
      if (vx * vx + vz * vz > 1) facing = Math.atan2(vx, vz);
    }
    const view = pickView(facing, camYaw, m.views);
    const col = m.columns[anim]! + frame;
    const r = frameRect(m, col, view.row);
    const u0 = r.x / r.atlasW;
    const u1 = (r.x + m.frameWidth) / r.atlasW;
    const v1 = 1 - r.y / r.atlasH;
    const v0 = 1 - (r.y + m.frameHeight) / r.atlasH;
    const key = `${atlas.manifest.id}@${this.atlases.epoch}:${col}:${view.row}:${view.mirror}`;
    if (v.atlasKey !== key) {
      v.atlasKey = key;
      if (v.mat.map !== atlas.texture) {
        v.mat.map = atlas.texture;
        v.mat.needsUpdate = true;
      }
      setUv(v.mesh.geometry, u0, v0, u1, v1, view.mirror);
    }
    const h = 1.62 * s.scale;
    v.mesh.scale.set(h * (m.frameWidth / m.frameHeight), h * stretch, 1);
    const flash = s.flashTicks > 0 ? (this.game.settings.reduceFlashes ? 1.5 : 3) : 1;
    const tf = s.transformed ? 1.25 : 1;
    // Kaioken strain: pulsing red tint on the body.
    const strain = s.strain ? 0.18 + Math.sin(this.time * 9) * 0.1 : 0;
    v.mat.color.setRGB(flash * tf * (1 + strain), flash * (s.transformed ? 1.15 : 1) * (1 - strain), flash * (1 - strain));
    v.mat.opacity = s.alpha;
    if (v.aura && v.auraMat) {
      const auraOn = s.aura || s.auraColor != null;
      v.aura.visible = auraOn;
      if (auraOn) {
        const red = s.auraColor === 0xff3a2a;
        const strip = red ? this.fxStrips.kaioken : this.fxStrips.carga;
        const fr = strip?.frames[Math.floor(this.time * 8) % (strip?.frames.length || 1)];
        if (strip && fr) {
          if (v.auraMat.map !== strip.tex) {
            v.auraMat.map = strip.tex;
            v.auraMat.blending = THREE.NormalBlending;
            v.auraMat.alphaTest = 0.12;
            v.auraMat.needsUpdate = true;
          }
          v.auraMat.color.set(0xffffff);
          setUv(v.aura.geometry, fr.u0, fr.v0, fr.u1, fr.v1, false);
          const aspect = frameAspect(strip.tex, fr);
          v.auraMat.opacity = 0.92;
          v.aura.scale.set(h * aspect * 1.35, h * stretch * 1.45, 1);
        } else {
          if (v.auraMat.map !== this.fxTex) {
            v.auraMat.map = this.fxTex;
            v.auraMat.blending = THREE.AdditiveBlending;
            v.auraMat.alphaTest = 0;
            v.auraMat.needsUpdate = true;
          }
          v.auraMat.color.set(s.auraColor ?? (s.transformed ? 0xffe04a : (e.appearance?.palette.aura ?? 0xffffff)));
          v.auraMat.opacity = 0.55 + Math.sin(this.time * 20) * 0.2;
          v.aura.scale.set(h * 1.25, h * stretch * 1.25 * (1 + Math.sin(this.time * 14) * 0.05), 1);
        }
        v.aura.position.set(0, -0.1, -0.08);
      }
    }
    if (v.alert) {
      const st = e.explorer?.state;
      v.alert.visible = st === 'ALERT' || st === 'CHASE';
      v.alert.position.set(0, h * stretch + 0.35, 0);
      v.alert.scale.set(0.45, 0.45 * Math.min(stretch, 1.4), 1);
    }
  }

  // ------------------------------------------------------------ frame

  sync(alpha: number, realDt: number): void {
    this.pendingKi = [];
    const g = this.game;
    // World visuals share the simulation's time scale (focus slow motion).
    const dt = realDt * g.timeScale;
    this.time += dt;
    this.buildMap();
    this.atlases.pump();
    g.viewAspect = this.camera.aspect;
    const rig = g.camera;
    rig.resolve((x, z) => g.map.tiles.visualHeightAt(x, z));
    this.applyFocusLook(g.focusFilter, realDt);
    // Sprites render between ticks. Shift the whole camera by the same fraction
    // so the chosen character stays in the centre of the screen while moving.
    const mode = g.fsm.state === 'PAUSED' ? g.fsm.previous : g.fsm.state;
    const followBattle = BATTLE_STATES.has(mode);
    const followWalk = mode === 'WORLD_EXPLORATION' || mode === 'RETURN_TO_WORLD';
    let ox = 0;
    let oy = 0;
    let oz = 0;
    if (followBattle || followWalk) {
      const subject = followBattle ? (g.controlled() ?? g.leader()) : g.leader();
      const t = subject.transform;
      const k = alpha - 1;
      ox = k * (t.pos.x - t.prev.x);
      oy = k * (t.pos.y - t.prev.y);
      oz = k * (t.pos.z - t.prev.z);
    }
    this.camera.position.set(rig.position.x + ox, rig.position.y + oy, rig.position.z + oz);
    this.camera.lookAt(rig.lookAt.x + ox, rig.lookAt.y + oy, rig.lookAt.z + oz);
    if (Math.abs(this.camera.fov - rig.pose.fov) > 0.01) {
      this.camera.fov = rig.pose.fov;
      this.camera.updateProjectionMatrix();
    }
    const fog = this.scene.fog as THREE.Fog;
    fog.near = rig.pose.distance * 2.2;
    fog.far = rig.pose.distance * 8 + 36;

    const camYaw = rig.pose.yaw;
    const stretch = 1 / Math.max(Math.cos(rig.pose.pitch), 0.5);
    this.updateTrees(camYaw, stretch, dt);
    if (!this.paintedWater) {
      const painted = this.backdrop.takeWater();
      if (painted) {
        painted.repeat.copy(this.waterTex.repeat);
        (this.water.material as THREE.MeshBasicMaterial).map = painted;
        this.waterTex.dispose();
        this.waterTex = painted;
        this.paintedWater = true;
      }
    }
    if (!this.paintedTrees && this.treeSheet && this.trees.length > 0) {
      this.trees.forEach((mesh, variant) => {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        const shape = this.treeShape[variant];
        mat.map = this.treeSheet;
        mat.alphaTest = 0.45;
        mat.needsUpdate = true;
        if (shape) setUv(mesh.geometry, shape.u0, shape.v0, shape.u1, shape.v1, false);
      });
      this.paintedTrees = true;
    }
    this.waterTex.offset.set(this.time * 0.012, this.time * 0.008);
    this.backdrop.update(this.camera.position.x, this.camera.position.z, rig.lookAt.x + ox, rig.lookAt.z + oz, camYaw, this.time, g.settings.reducedMotion);

    const battle = BATTLE_STATES.has(g.fsm.state) || (g.fsm.state === 'PAUSED' && BATTLE_STATES.has(g.fsm.previous));
    const seen = new Set<number>();
    for (const e of g.world.query('sprite')) {
      seen.add(e.id);
      this.syncSprite(e, alpha, camYaw, stretch, battle);
    }
    for (const id of [...this.views.keys()]) if (!seen.has(id)) this.removeView(id);

    // Projectiles: full camera-facing billboards.
    const pseen = new Set<number>();
    for (const e of g.world.query('projectile')) {
      pseen.add(e.id);
      let pv = this.projViews.get(e.id);
      const pr = e.projectile!;
      if (!pv) {
        const mat = new THREE.MeshBasicMaterial({ map: this.fxTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
        const mesh = new THREE.Mesh(makeCenteredQuad(), mat);
        mesh.renderOrder = 6;
        this.scene.add(mesh);
        const glow = this.lightPool(0, 0);
        pv = { mesh, mat, frames: PROJECTILE_FRAMES[pr.visual as ProjectileVisual] ?? FX.kiBall, glow };
        this.projViews.set(e.id, pv);
      }
      const t = e.transform;
      pv.mesh.position.set(t.prev.x + (t.pos.x - t.prev.x) * alpha, t.prev.y + (t.pos.y - t.prev.y) * alpha, t.prev.z + (t.pos.z - t.prev.z) * alpha);
      const painted = this.effectStrip(pr.visual);
      const disc = pr.visual === 'kienzan';
      const sz = pr.radius * (painted ? (disc ? 5 : 4.2) : disc ? 4 : 3);
      if (disc) {
        pv.mesh.rotation.set(-Math.PI / 2, this.time * 8, 0);
        pv.mesh.scale.set(sz, sz, 1);
      } else {
        pv.mesh.quaternion.copy(this.camera.quaternion);
        pv.mesh.scale.set(sz, sz, 1);
      }
      const pool = (1.8 + pr.radius * 4) * g.day.lightBrightness * (0.75 + 0.85 * g.day.night);
      pv.glow.visible = true;
      pv.glow.position.set(pv.mesh.position.x, 0.06, pv.mesh.position.z);
      pv.glow.scale.set(pool, pool, 1);
      (pv.glow.material as THREE.MeshBasicMaterial).opacity = Math.min(1, (0.4 + 0.6 * g.day.night) * g.day.lightBrightness);
      this.pendingKi.push({ x: pv.mesh.position.x, y: pv.mesh.position.y, z: pv.mesh.position.z, radius: 1.1 + pr.radius * 2.2 });
      if (painted) {
        if (pv.mat.map !== painted.tex) {
          pv.mat.map = painted.tex;
          pv.mat.blending = THREE.NormalBlending;
          pv.mat.alphaTest = 0.12;
          pv.mat.color.set(0xffffff);
          pv.mat.needsUpdate = true;
        }
        const fr = painted.frames[Math.floor(this.time * (disc ? 16 : 10)) % painted.frames.length]!;
        setUv(pv.mesh.geometry, fr.u0, fr.v0, fr.u1, fr.v1, false);
      } else this.setFxUv(pv.mesh.geometry, pv.frames[Math.floor(this.time * (disc ? 24 : 12)) % pv.frames.length]);
      const trail = pr.visual === 'kienzan' ? 0xffe07a : pr.visual === 'sokidan' ? 0xd8f4ff : 0x9ad8ff;
      if (Math.random() < (pr.visual === 'sokidan' ? 0.6 : 0.3) * Math.min(1, g.timeScale * 2)) {
        this.spawnFx(FX.dust, pv.mesh.position.x, pv.mesh.position.y, pv.mesh.position.z, { size: sz * 0.5, life: 0.2, color: trail });
      }
    }
    for (const [id, pv] of [...this.projViews]) {
      if (pseen.has(id)) continue;
      this.scene.remove(pv.mesh);
      this.scene.remove(pv.glow);
      pv.mesh.geometry.dispose();
      pv.mat.dispose();
      pv.glow.geometry.dispose();
      (pv.glow.material as THREE.Material).dispose();
      this.projViews.delete(id);
    }

    this.updateFx(dt);
    this.updateBeams(dt);
    this.uploadLights();
    this.updateMarkers(battle, alpha);
    this.updateDebug(battle);
  }

  /** Packs path lamps, windows and this frame's ki into the grade shader. */
  private uploadLights(): void {
    const day = this.game.day;
    const lights: WorldLight[] = [];
    const lit = day.lampsOn * day.lightBrightness;
    if (lit > 0.02) {
      for (const lamp of this.lamps) lights.push({ x: lamp.x, y: 1.75, z: lamp.z, radius: day.lampRadius * Math.min(1.4, lit) });
      for (const win of WINDOW_LIGHTS) lights.push({ x: win.x, y: win.y, z: win.z, radius: win.radius * Math.min(1.4, lit) });
    }
    for (const ki of this.pendingKi) lights.push(ki);
    uploadWorldLights(lights);
    this.kiLights = this.pendingKi;
  }

  /** Desaturate + darken the world (not the HUD) while focus is active. */
  private applyFocusLook(k: number, realDt: number): void {
    const day = this.game.day;
    if (Math.abs(day.shadowSoftness - this.shadowSoft) > 0.01) {
      this.shadowSoft = day.shadowSoftness;
      const next = shadowTexture(day.shadowSoftness);
      this.shadowMat.map = next;
      this.shadowTex.dispose();
      this.shadowTex = next;
      this.shadowMat.needsUpdate = true;
    }
    this.shadowMat.opacity = 0.5;
    const soft = 1 + day.shadowSoftness * 0.7;
    for (const mesh of this.houseShadows) {
      const w = mesh.userData.w as number;
      const d = mesh.userData.d as number;
      const hx = mesh.userData.x as number;
      const hz = mesh.userData.z as number;
      const cast = this.castDir(hx, hz);
      mesh.position.set(hx - cast.x * cast.reach, 0.04, hz - cast.z * cast.reach);
      mesh.rotation.y = Math.atan2(cast.x, cast.z);
      mesh.scale.set(w * soft, d * (0.8 + cast.reach * 0.45) * soft, 1);
      mesh.visible = cast.vis > 0.04;
    }
    const glow = Math.min(1.4, day.lampsOn * day.lightBrightness);
    const lampYaw = this.game.camera.pose.yaw;
    const lampStretch = Math.min(1.35, 1 / Math.max(Math.cos(this.game.camera.pose.pitch), 0.5));
    const lampStrip = this.fxStrips.lamp;
    if (this.lampMat) {
      const on = day.lampsOn;
      const shade = 0.32 + 0.68 * on;
      this.lampMat.color.setRGB(shade, shade * (0.94 + 0.06 * on), shade * (0.86 + 0.14 * on));
    }
    for (const lamp of this.lamps) {
      const diameter = day.lampRadius * 2;
      lamp.pool.scale.set(diameter, diameter, 1);
      lamp.pool.visible = glow > 0.03;
      (lamp.pool.material as THREE.MeshBasicMaterial).opacity = glow * 0.72;
      const hot = 0.35 + glow;
      (lamp.bulb.material as THREE.MeshBasicMaterial).color.setRGB(Math.min(1, 0.55 * hot), Math.min(1, 0.4 * hot), 0.18 * hot);
      (lamp.pole.material as THREE.MeshBasicMaterial).color.setRGB(0.28 * day.ambient[0], 0.28 * day.ambient[1], 0.32 * day.ambient[2]);
      if (lamp.post && lampStrip) {
        const view = pickView(0, lampYaw, LAMP_VIEWS);
        const fr = lampStrip.frames[Math.min(view.row, lampStrip.frames.length - 1)];
        if (fr) {
          setUv(lamp.post.geometry, fr.u0, fr.v0, fr.u1, fr.v1, view.mirror);
          const height = 2.35;
          lamp.post.scale.set(height * frameAspect(lampStrip.tex, fr), height * lampStretch, 1);
        }
        lamp.post.rotation.y = lampYaw;
      }
    }
    if (this.windowPool) {
      const diameter = 5.2 * Math.max(0.35, day.lightBrightness);
      this.windowPool.scale.set(diameter, diameter, 1);
      this.windowPool.visible = glow > 0.03;
      (this.windowPool.material as THREE.MeshBasicMaterial).opacity = glow * 0.85;
    }
    GRADE_UNIFORMS.uAmbient.value.set(day.ambient[0], day.ambient[1], day.ambient[2]);
    GRADE_UNIFORMS.uSepia.value = day.sepia;
    this.backdrop.setGrade(day.ambient[0], day.ambient[1], day.ambient[2], glow);
    const f = BALANCE.focus;
    GRADE_UNIFORMS.uFocusDesat.value = f.desaturate * k;
    GRADE_UNIFORMS.uFocusDark.value = f.darken * k;
    // Short white flash from Taiyōken; softened when reduceFlashes is on.
    const flashK = this.screenFlash > 0 ? Math.min(1, this.screenFlash * 4) * (this.game.settings.reduceFlashes ? 0.35 : 0.9) : 0;
    this.screenFlash = Math.max(0, this.screenFlash - realDt);
    // Fog stays unfiltered: the shader patch already filters fogged fragments, so they match the filtered sky.
    const fog = (this.scene.fog as THREE.Fog).color;
    fog.copy(this.skyBase);
    fog.lerp(this.dayTint.setRGB(day.ambient[0], day.ambient[1], day.ambient[2]), 0.85);
    if (flashK > 0) fog.lerp(WHITE, flashK);
    const bg = this.scene.background as THREE.Color;
    bg.copy(fog);
    const l = bg.r * 0.299 + bg.g * 0.587 + bg.b * 0.114;
    bg.lerp(this.grey.setRGB(l, l, l), f.desaturate * k).multiplyScalar(1 - f.darken * k);
  }

  private effectStrip(visual: string): PaintStrip | null {
    if (visual === 'kienzan') return this.fxStrips.kienzan ?? null;
    if (visual === 'sokidan') return this.fxStrips.sokidan ?? null;
    if (visual === 'ki_wave') return this.fxStrips.punta ?? this.fxStrips.disparo ?? null;
    if (visual === 'ki_ball' || visual === 'kakusan' || visual === 'ki_charged') return this.fxStrips.disparo ?? null;
    return null;
  }

  private spawnBeam(b: GameEvents['beamFired']): void {
    const mk = (cell: number, strip: PaintStrip | undefined): THREE.Mesh => {
      const painted = !!strip;
      const mat = new THREE.MeshBasicMaterial({
        map: strip?.tex ?? this.fxTex,
        transparent: true,
        depthWrite: false,
        blending: painted ? THREE.NormalBlending : THREE.AdditiveBlending,
        color: painted ? 0xffffff : b.color,
        side: THREE.DoubleSide,
        fog: false,
        alphaTest: painted ? 0.08 : 0,
      });
      const g = new THREE.PlaneGeometry(1, 1);
      if (!painted) this.setFxUv(g, cell);
      else if (strip?.frames[0] && !strip.scroll) {
        const fr = strip.frames[0];
        setUv(g, fr.u0, fr.v0, fr.u1, fr.v1, false);
      }
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 7;
      this.scene.add(m);
      return m;
    };
    this.beams.push({ mesh: mk(FX.beamBody, this.fxStrips.haz), head: mk(FX.beamHead, this.fxStrips.punta), x: b.x, y: b.y, z: b.z, dirX: b.dirX, dirZ: b.dirZ, length: b.length, width: b.width, age: 0, life: Math.max(0.15, b.ticks / 60) });
  }

  private updateBeams(dt: number): void {
    const camPos = this.camera.position;
    const axis = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const up = new THREE.Vector3();
    const n = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      b.age += dt;
      if (b.age >= b.life) {
        for (const m of [b.mesh, b.head]) {
          this.scene.remove(m);
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
        this.beams.splice(i, 1);
        continue;
      }
      // Grows out over the first 15% of its life, then thins out at the end.
      const k = b.age / b.life;
      const reach = b.length * Math.min(1, k / 0.15);
      const thick = b.width * 2 * (k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1) * (1 + Math.sin(this.time * 40) * 0.06);
      axis.set(b.dirX, 0, b.dirZ).normalize();
      const cx = b.x + axis.x * reach * 0.5;
      const cz = b.z + axis.z * reach * 0.5;
      // Rotate the quad around its long axis so its face points at the camera.
      toCam.set(camPos.x - cx, camPos.y - b.y, camPos.z - cz);
      n.copy(toCam).addScaledVector(axis, -toCam.dot(axis)).normalize();
      up.crossVectors(n, axis).normalize();
      basis.makeBasis(axis, up, n);
      b.mesh.quaternion.setFromRotationMatrix(basis);
      b.mesh.position.set(cx, b.y, cz);
      b.mesh.scale.set(Math.max(0.01, reach), thick, 1);
      const haz = this.fxStrips.haz;
      if (haz?.frames[0]) {
        if (haz.scroll) {
          const band = haz.frames[0];
          const repeats = Math.max(1, reach / 3.2);
          setUv(b.mesh.geometry, this.time * 1.6, band.v0, this.time * 1.6 + repeats, band.v1, false);
        } else {
          const fr = haz.frames[Math.floor(this.time * 12) % haz.frames.length]!;
          setUv(b.mesh.geometry, fr.u0, fr.v0, fr.u1, fr.v1, false);
        }
      }
      const punta = this.fxStrips.punta;
      if (punta?.frames.length) {
        const fr = punta.frames[Math.floor(this.time * 12) % punta.frames.length]!;
        setUv(b.head.geometry, fr.u0, fr.v0, fr.u1, fr.v1, false);
      }
      b.head.position.set(b.x + axis.x * reach, b.y, b.z + axis.z * reach);
      this.pendingKi.push({ x: cx, y: b.y, z: cz, radius: Math.max(1.6, thick * 1.8) });
      b.head.quaternion.copy(this.camera.quaternion);
      b.head.scale.set(thick * 2.2, thick * 2.2, 1);
    }
  }

  private updateFx(dt: number): void {
    for (const f of this.fxPool) {
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= f.life) {
        f.active = false;
        f.mesh.visible = false;
        continue;
      }
      const k = f.age / f.life;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      f.mesh.position.set(f.x, f.y, f.z);
      if (!f.ground) f.mesh.quaternion.copy(this.camera.quaternion);
      const size = Math.max(0.05, f.size + f.grow * f.age);
      f.mesh.scale.set(size, size, 1);
      if (f.strip && f.strip.length > 0) {
        const fr = f.strip[Math.min(f.strip.length - 1, Math.floor(k * f.strip.length))]!;
        setUv(f.mesh.geometry, fr.u0, fr.v0, fr.u1, fr.v1, false);
        f.mat.opacity = k < 0.72 ? 1 : 1 - (k - 0.72) / 0.28;
      } else {
        if (f.digit < 0 && typeof f.frames !== 'number') this.setFxUv(f.mesh.geometry, f.frames[Math.min(f.frames.length - 1, Math.floor(k * f.frames.length))]);
        f.mat.opacity = f.digit >= 0 ? Math.min(1, (1 - k) * 2) : 1 - k * k;
      }
    }
  }

  private updateMarkers(battle: boolean, alpha: number): void {
    const g = this.game;
    const ctl = g.controlled();
    const showCombat = battle && !!ctl?.combatant?.engaged;
    const target = showCombat ? g.world.get(ctl!.combatant!.targetId) : undefined;
    this.targetArrow.visible = !!target && target.combatant?.state !== 'DEFEATED';
    if (target && this.targetArrow.visible) {
      const t = target.transform;
      const y = t.prev.y + (t.pos.y - t.prev.y) * alpha;
      this.targetArrow.position.set(t.pos.x, y + 1.62 * (target.sprite?.scale ?? 1) * 1.1 + 0.5 + Math.sin(this.time * 6) * 0.08, t.pos.z);
      this.targetArrow.quaternion.copy(this.camera.quaternion);
      this.targetArrow.scale.set(0.5, 0.5, 1);
    }
    this.ctlRing.visible = showCombat;
    if (ctl && showCombat) {
      const t = ctl.transform;
      const gh = g.map.tiles.heightAt(t.pos.x, t.pos.z);
      this.ctlRing.position.set(t.pos.x, gh + 0.05, t.pos.z);
      const s = 1.2 + Math.sin(this.time * 4) * 0.05;
      this.ctlRing.scale.set(s, s, 1);
    }
  }

  private updateDebug(battle: boolean): void {
    const g = this.game;
    this.debugGroup.visible = g.settings.debug;
    if (!g.settings.debug) return;
    let i = 0;
    const sphere = (x: number, y: number, z: number, r: number, color: number): void => {
      let m = this.debugSpheres[i];
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshBasicMaterial({ wireframe: true, color, depthTest: false }));
        this.debugGroup.add(m);
        this.debugSpheres.push(m);
      }
      (m.material as THREE.MeshBasicMaterial).color.set(color);
      m.visible = true;
      m.position.set(x, y, z);
      m.scale.setScalar(r);
      i++;
    };
    for (const e of g.world.query('combatant')) {
      const c = e.combatant!;
      const p = e.transform.pos;
      const b = e.body!;
      if (battle && !c.engaged) continue;
      sphere(p.x, p.y + b.radius * 0.5, p.z, b.radius, 0x4aff6a);
      sphere(p.x, p.y + b.height - b.radius * 0.5, p.z, b.radius, 0x4aff6a);
      if (c.moveId && isAttacking(c.state)) {
        const mv = getMove(c.moveId);
        if (!mv.projectile && c.moveTick >= mv.startup && c.moveTick < mv.startup + mv.active) {
          hitboxCenter(this.scratch, p, e.transform.yaw, b.height, e.sprite?.scale ?? 1, mv.hitbox);
          sphere(this.scratch.x, this.scratch.y, this.scratch.z, mv.hitbox.radius * (e.sprite?.scale ?? 1), 0xff3a3a);
        }
      }
    }
    for (const e of g.world.query('projectile')) sphere(e.transform.pos.x, e.transform.pos.y, e.transform.pos.z, e.projectile!.radius, 0xffaa3a);
    for (; i < this.debugSpheres.length; i++) this.debugSpheres[i].visible = false;
  }

  dispose(): void {
    for (const u of this.unsub) u();
    for (const id of [...this.views.keys()]) this.removeView(id);
    this.atlases.dispose();
    this.terrainTex.dispose();
    this.groundTex?.dispose();
    this.treeTex.dispose();
    this.treeSheet?.dispose();
    this.propsTex.dispose();
    this.fxTex.dispose();
    this.waterTex.dispose();
    this.floorTex.dispose();
    this.shadowTex.dispose();
    this.shadowMat.dispose();
    this.glowTex.dispose();
    this.arenaTex?.dispose();
    this.itemsTex?.dispose();
    this.lampMat?.dispose();
    for (const strip of Object.values(this.fxStrips)) strip?.tex.dispose();
    for (const m of this.exterior) m.geometry.dispose();
    for (const b of this.beams) for (const m of [b.mesh, b.head]) m.geometry.dispose();
    this.beams = [];
  }
}

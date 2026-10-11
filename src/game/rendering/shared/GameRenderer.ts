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
import { ANIM_FALLBACK, frameAt, frameRect, pickView } from './manifest';
import { buildTerrainGeometry, exteriorTreePositions, treePositions, WATER_LEVEL } from './terrainMesh';
import { DIGIT_ROW_Y, FX, FX_COLS, FX_ROWS, generateEffects, generateForestFloor, generateProps, generateTerrainAtlas, generateTrees, generateWater, PROP_CELLS, VALLEY_PALETTE } from './worldArt';

/**
 * Focus slow-motion look: every world material gets the same two uniforms
 * (desaturate, darken). HUD and markers are not patched and stay legible.
 */
const FOCUS_UNIFORMS = { uFocusDesat: { value: 0 }, uFocusDark: { value: 0 } };

function patchFocus<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (s) => {
    s.uniforms.uFocusDesat = FOCUS_UNIFORMS.uFocusDesat;
    s.uniforms.uFocusDark = FOCUS_UNIFORMS.uFocusDark;
    s.fragmentShader =
      'uniform float uFocusDesat;\nuniform float uFocusDark;\n' +
      s.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n{ float l = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)); gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(l), uFocusDesat) * (1.0 - uFocusDark); }',
      );
  };
  m.customProgramCacheKey = () => 'focus-filter';
  return m;
}

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

interface SpriteView {
  root: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  shadow: THREE.Mesh;
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
  private projViews = new Map<number, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; frames: readonly number[] }>();
  private terrain: THREE.Mesh | null = null;
  private water: THREE.Mesh;
  private waterTex: THREE.DataTexture;
  private trees: THREE.InstancedMesh[] = [];
  private treeData: { x: number; z: number; variant: number; size: number }[] = [];
  private lastTreeYaw = NaN;
  private lastTreeStretch = NaN;
  private lastTreeCam = { x: NaN, z: NaN };
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
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private scratch = vec3();
  /** World clock (slowed by focus); drives water, props and effects. */
  private time = 0;
  private maxFx: number;
  private exterior: THREE.Mesh[] = [];
  private floorTex: THREE.DataTexture;
  private beams: Beam[] = [];
  private screenFlash = 0;
  private skyBase = new THREE.Color(VALLEY_PALETTE.sky);
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

    // Water only exists inside the map (rivers); outside is forest ground.
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), patchFocus(new THREE.MeshBasicMaterial({ map: this.waterTex, color: 0xffffff })));
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

    for (let i = 0; i < this.maxFx; i++) {
      const mat = patchFocus(fxMat());
      const mesh = new THREE.Mesh(makeCenteredQuad(), mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.fxPool.push({ mesh, mat, active: false, frames: 0, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, digit: -1, ground: false });
    }
    this.subscribe();
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
    for (const m of this.exterior) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    const tiles = map.tiles;
    this.terrain = new THREE.Mesh(
      buildTerrainGeometry(tiles),
      patchFocus(new THREE.MeshBasicMaterial({ map: this.terrainTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })),
    );
    this.scene.add(this.terrain);
    this.water.scale.set(tiles.width, tiles.height, 1);
    this.water.position.set(tiles.width / 2, WATER_LEVEL, tiles.height / 2);
    this.waterTex.repeat.set(tiles.width / 2, tiles.height / 2);

    // Exterior: a frame of forest floor around the map (never the sky colour or open water).
    const E = 90;
    const W = tiles.width;
    const H = tiles.height;
    const floorMat = patchFocus(new THREE.MeshBasicMaterial({ map: this.floorTex }));
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

    this.treeData = [...treePositions(tiles), ...exteriorTreePositions(tiles, this.lowQuality ? 5 : 7, this.lowQuality ? 1.8 : 1.45)];
    this.trees = [0, 1].map((variant) => {
      const count = this.treeData.filter((t) => t.variant === variant).length;
      const g = makeQuad();
      setUv(g, variant * 0.5, 0, variant * 0.5 + 0.5, 1, false);
      const m = new THREE.InstancedMesh(g, patchFocus(new THREE.MeshBasicMaterial({ map: this.treeTex, alphaTest: 0.5 })), Math.max(1, count));
      m.count = count;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    });
    this.lastTreeYaw = NaN;
  }

  /**
   * Billboard trees face the camera. Trees standing in the strip just in
   * front of the camera (below the bottom of the screen, or barely above it)
   * are cut away: stretched for the pitch, they would otherwise cover half
   * the view at the map edges.
   */
  private updateTrees(yaw: number, stretch: number): void {
    const rig = this.game.camera;
    const cx = rig.position.x;
    const cz = rig.position.z;
    if (Math.abs(yaw - this.lastTreeYaw) < 1e-3 && Math.abs(stretch - this.lastTreeStretch) < 1e-3 && Math.hypot(cx - this.lastTreeCam.x, cz - this.lastTreeCam.z) < 0.2) return;
    this.lastTreeYaw = yaw;
    this.lastTreeStretch = stretch;
    this.lastTreeCam.x = cx;
    this.lastTreeCam.z = cz;
    const p = rig.pose;
    const camH = Math.max(0.5, rig.position.y - rig.lookAt.y);
    const bottomRay = Math.min(p.pitch + (p.fov * Math.PI) / 360, Math.PI / 2 - 0.02);
    const cut = camH / Math.tan(bottomRay) + BALANCE.render.treeCutaway;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const counters = [0, 0];
    this.tmpQ.setFromAxisAngle(this.up, yaw);
    for (const t of this.treeData) {
      const ahead = (t.x - cx) * fx + (t.z - cz) * fz;
      this.tmpV.set(t.x, 0, t.z);
      if (ahead < cut) this.tmpS.set(0, 0, 0);
      else this.tmpS.set(2.6 * t.size, 3.4 * t.size * stretch, 1);
      this.tmpMat.compose(this.tmpV, this.tmpQ, this.tmpS);
      this.trees[t.variant].setMatrixAt(counters[t.variant]++, this.tmpMat);
    }
    for (const m of this.trees) m.instanceMatrix.needsUpdate = true;
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

  private spawnFx(frames: readonly number[] | number, x: number, y: number, z: number, opts: Partial<Pick<Fx, 'life' | 'size' | 'vx' | 'vy' | 'vz' | 'grow' | 'ground'>> & { color?: number; digit?: number; additive?: boolean } = {}): void {
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
    fx.mat.color.set(opts.color ?? 0xffffff);
    fx.mat.blending = opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
    fx.mat.opacity = 1;
    fx.mesh.visible = true;
    fx.mesh.rotation.set(fx.ground ? -Math.PI / 2 : 0, 0, 0);
    if (fx.digit >= 0) this.setDigitUv(fx.mesh.geometry, fx.digit);
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
        this.spawnFx(FX.shockwave, t.fromX, t.fromY + 0.8, t.fromZ, { size: 0.5, grow: 3, life: 0.2, color: 0xffffff });
        const e = this.game.world.get(t.entityId);
        if (e) this.spawnFx(FX.shockwave, e.transform.pos.x, e.transform.pos.y + 0.8, e.transform.pos.z, { size: 1.6, grow: -4, life: 0.2, color: 0xffffff });
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
        this.spawnFx(FX.flash, f.x, f.y, f.z, { size: 1.2, grow: f.radius * 2.5, life: 0.35, color: 0xffffff });
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
    const mat = patchFocus(new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, map: this.propsTex }));
    const mesh = new THREE.Mesh(makeQuad(), mat);
    root.add(mesh);
    const shadow = new THREE.Mesh(makeCenteredQuad(), patchFocus(new THREE.MeshBasicMaterial({ map: this.propsTex, transparent: true, depthWrite: false })));
    shadow.rotation.x = -Math.PI / 2;
    const cw = 32 / (8 * 32);
    const a = shadow.geometry.getAttribute('uv') as THREE.BufferAttribute;
    a.setXY(0, PROP_CELLS.shadow * cw, 1);
    a.setXY(1, (PROP_CELLS.shadow + 1) * cw, 1);
    a.setXY(2, PROP_CELLS.shadow * cw, 0);
    a.setXY(3, (PROP_CELLS.shadow + 1) * cw, 0);
    this.scene.add(shadow);
    const isChar = !!appearanceFor(e.sprite!.atlas);
    let aura: THREE.Mesh | null = null;
    let auraMat: THREE.MeshBasicMaterial | null = null;
    let alert: THREE.Mesh | null = null;
    if (isChar) {
      auraMat = patchFocus(new THREE.MeshBasicMaterial({ map: this.fxTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: e.appearance?.palette.aura ?? 0xffffff }));
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
    v = { root, mesh, mat, shadow, aura, auraMat, alert, atlasKey: '', kind: isChar ? 'char' : 'prop' };
    this.views.set(e.id, v);
    return v;
  }

  private removeView(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.root);
    this.scene.remove(v.shadow);
    v.mesh.geometry.dispose();
    v.mat.dispose();
    v.shadow.geometry.dispose();
    (v.shadow.material as THREE.Material).dispose();
    v.aura?.geometry.dispose();
    v.auraMat?.dispose();
    this.views.delete(id);
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
    v.shadow.position.set(x, Math.max(ground, WATER_LEVEL) + 0.03, z);
    v.shadow.scale.set(shadowSize, shadowSize * 0.6, 1);
    v.shadow.visible = v.root.visible;

    if (v.kind === 'prop') {
      const cell = this.propCell(e);
      const key = `prop${cell}`;
      if (v.atlasKey !== key) {
        v.atlasKey = key;
        v.mat.map = this.propsTex;
        setUv(v.mesh.geometry, (cell * 32) / 256, 0, ((cell + 1) * 32) / 256, 1, false);
      }
      const size = s.atlas === 'prop:boulder' ? 2.2 : s.atlas === 'prop:crystal' ? 1.3 : 0.9;
      v.mesh.scale.set(size, size * Math.min(stretch, 1.6), 1);
      if (s.atlas === 'prop:pickup' || s.atlas === 'prop:stone') v.mesh.position.y = 0.1 + Math.sin(this.time * 3 + e.id) * 0.08;
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
    const key = `${atlas.manifest.id}:${col}:${view.row}:${view.mirror}`;
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
        v.auraMat.color.set(s.auraColor ?? (s.transformed ? 0xffe04a : (e.appearance?.palette.aura ?? 0xffffff)));
        v.auraMat.opacity = 0.55 + Math.sin(this.time * 20) * 0.2;
        v.aura.scale.set(h * 1.25, h * stretch * 1.25 * (1 + Math.sin(this.time * 14) * 0.05), 1);
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
    fog.near = rig.pose.distance * 1.6;
    fog.far = rig.pose.distance * 4.5 + 10;

    const camYaw = rig.pose.yaw;
    const stretch = 1 / Math.max(Math.cos(rig.pose.pitch), 0.5);
    this.updateTrees(camYaw, stretch);
    this.waterTex.offset.set(this.time * 0.05, this.time * 0.03);

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
        const mat = patchFocus(new THREE.MeshBasicMaterial({ map: this.fxTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        const mesh = new THREE.Mesh(makeCenteredQuad(), mat);
        mesh.renderOrder = 6;
        this.scene.add(mesh);
        pv = { mesh, mat, frames: PROJECTILE_FRAMES[pr.visual as ProjectileVisual] ?? FX.kiBall };
        this.projViews.set(e.id, pv);
      }
      const t = e.transform;
      pv.mesh.position.set(t.prev.x + (t.pos.x - t.prev.x) * alpha, t.prev.y + (t.pos.y - t.prev.y) * alpha, t.prev.z + (t.pos.z - t.prev.z) * alpha);
      pv.mesh.quaternion.copy(this.camera.quaternion);
      const disc = pr.visual === 'kienzan';
      const sz = pr.radius * (disc ? 4 : 3);
      pv.mesh.scale.set(sz, disc ? sz * 0.8 : sz, 1);
      this.setFxUv(pv.mesh.geometry, pv.frames[Math.floor(this.time * (disc ? 24 : 12)) % pv.frames.length]);
      const trail = pr.visual === 'kienzan' ? 0xffe07a : pr.visual === 'sokidan' ? 0xd8f4ff : 0x9ad8ff;
      if (Math.random() < (pr.visual === 'sokidan' ? 0.6 : 0.3) * Math.min(1, g.timeScale * 2)) {
        this.spawnFx(FX.dust, pv.mesh.position.x, pv.mesh.position.y, pv.mesh.position.z, { size: sz * 0.5, life: 0.2, color: trail });
      }
    }
    for (const [id, pv] of [...this.projViews]) {
      if (pseen.has(id)) continue;
      this.scene.remove(pv.mesh);
      pv.mesh.geometry.dispose();
      pv.mat.dispose();
      this.projViews.delete(id);
    }

    this.updateFx(dt);
    this.updateBeams(dt);
    this.updateMarkers(battle, alpha);
    this.updateDebug(battle);
  }

  /** Desaturate + darken the world (not the HUD) while focus is active. */
  private applyFocusLook(k: number, realDt: number): void {
    const f = BALANCE.focus;
    FOCUS_UNIFORMS.uFocusDesat.value = f.desaturate * k;
    FOCUS_UNIFORMS.uFocusDark.value = f.darken * k;
    // Short white flash from Taiyōken; softened when reduceFlashes is on.
    const flashK = this.screenFlash > 0 ? Math.min(1, this.screenFlash * 4) * (this.game.settings.reduceFlashes ? 0.35 : 0.9) : 0;
    this.screenFlash = Math.max(0, this.screenFlash - realDt);
    // Fog stays unfiltered: the shader patch already filters fogged fragments, so they match the filtered sky.
    const fog = (this.scene.fog as THREE.Fog).color;
    fog.copy(this.skyBase);
    if (flashK > 0) fog.lerp(WHITE, flashK);
    const bg = this.scene.background as THREE.Color;
    bg.copy(fog);
    const l = bg.r * 0.299 + bg.g * 0.587 + bg.b * 0.114;
    bg.lerp(this.grey.setRGB(l, l, l), f.desaturate * k).multiplyScalar(1 - f.darken * k);
  }

  private spawnBeam(b: GameEvents['beamFired']): void {
    const mk = (cell: number): THREE.Mesh => {
      const mat = patchFocus(new THREE.MeshBasicMaterial({ map: this.fxTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: b.color, side: THREE.DoubleSide }));
      const g = new THREE.PlaneGeometry(1, 1);
      this.setFxUv(g, cell);
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 7;
      this.scene.add(m);
      return m;
    };
    this.beams.push({ mesh: mk(FX.beamBody), head: mk(FX.beamHead), x: b.x, y: b.y, z: b.z, dirX: b.dirX, dirZ: b.dirZ, length: b.length, width: b.width, age: 0, life: Math.max(0.15, b.ticks / 60) });
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
      b.head.position.set(b.x + axis.x * reach, b.y, b.z + axis.z * reach);
      b.head.quaternion.copy(this.camera.quaternion);
      b.head.scale.set(thick * 1.5, thick * 1.5, 1);
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
      if (f.digit < 0 && typeof f.frames !== 'number') this.setFxUv(f.mesh.geometry, f.frames[Math.min(f.frames.length - 1, Math.floor(k * f.frames.length))]);
      f.mat.opacity = f.digit >= 0 ? Math.min(1, (1 - k) * 2) : 1 - k * k;
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
    this.treeTex.dispose();
    this.propsTex.dispose();
    this.fxTex.dispose();
    this.waterTex.dispose();
    this.floorTex.dispose();
    for (const m of this.exterior) m.geometry.dispose();
    for (const b of this.beams) for (const m of [b.mesh, b.head]) m.geometry.dispose();
    this.beams = [];
  }
}

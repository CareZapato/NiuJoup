import * as THREE from 'three';
import type { Entity } from '../../components';
import { getMove } from '../../content/moves';
import type { Game } from '../../Game';
import { isAttacking } from '../../systems/combat/CombatSystem';
import { hitboxCenter } from '../../systems/collision/shapes';
import { vec3 } from '../../core/math';
import { type Atlas, AtlasCache, appearanceFor, makeTexture } from './AtlasCache';
import { frameAt, pickView } from './manifest';
import { buildTerrainGeometry, treePositions, WATER_LEVEL } from './terrainMesh';
import { DIGIT_ROW_Y, FX, FX_COLS, FX_ROWS, generateEffects, generateProps, generateTerrainAtlas, generateTrees, generateWater, PROP_CELLS, VALLEY_PALETTE } from './worldArt';

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
  private time = 0;
  private maxFx: number;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private game: Game,
    opts: RendererOptions,
  ) {
    this.maxFx = opts.mobile || game.settings.quality === 'low' ? 60 : 140;
    scene.background = new THREE.Color(VALLEY_PALETTE.sky);
    scene.fog = new THREE.Fog(VALLEY_PALETTE.sky, 30, 80);
    this.terrainTex = makeTexture(generateTerrainAtlas());
    this.treeTex = makeTexture(generateTrees());
    this.propsTex = makeTexture(generateProps());
    this.fxTex = makeTexture(generateEffects());
    this.waterTex = makeTexture(generateWater(), true);

    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.waterTex, color: 0xffffff }));
    this.water.rotation.x = -Math.PI / 2;
    scene.add(this.water);

    const under = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x2f6a26 }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = WATER_LEVEL - 0.05;
    scene.add(under);

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
      const mat = fxMat();
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
    const tiles = map.tiles;
    this.terrain = new THREE.Mesh(
      buildTerrainGeometry(tiles),
      new THREE.MeshBasicMaterial({ map: this.terrainTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
    );
    this.scene.add(this.terrain);
    this.water.scale.set(tiles.width + 40, tiles.height + 40, 1);
    this.water.position.set(tiles.width / 2, WATER_LEVEL, tiles.height / 2);
    this.waterTex.repeat.set((tiles.width + 40) / 2, (tiles.height + 40) / 2);

    this.treeData = treePositions(tiles);
    this.trees = [0, 1].map((variant) => {
      const count = this.treeData.filter((t) => t.variant === variant).length;
      const g = makeQuad();
      setUv(g, variant * 0.5, 0, variant * 0.5 + 0.5, 1, false);
      const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ map: this.treeTex, alphaTest: 0.5 }), Math.max(1, count));
      m.count = count;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    });
    this.lastTreeYaw = NaN;
  }

  private updateTrees(yaw: number, stretch: number): void {
    if (Math.abs(yaw - this.lastTreeYaw) < 1e-3 && Math.abs(stretch - this.lastTreeStretch) < 1e-3) return;
    this.lastTreeYaw = yaw;
    this.lastTreeStretch = stretch;
    const counters = [0, 0];
    this.tmpQ.setFromAxisAngle(this.up, yaw);
    for (const t of this.treeData) {
      this.tmpV.set(t.x, 0, t.z);
      this.tmpS.set(2.6 * t.size, 3.4 * t.size * stretch, 1);
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
    );
  }

  // ------------------------------------------------------------ sprites

  private ensureView(e: Entity): SpriteView {
    let v = this.views.get(e.id);
    if (v) return v;
    const root = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, map: this.propsTex });
    const mesh = new THREE.Mesh(makeQuad(), mat);
    root.add(mesh);
    const shadow = new THREE.Mesh(makeCenteredQuad(), new THREE.MeshBasicMaterial({ map: this.propsTex, transparent: true, depthWrite: false }));
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
      auraMat = new THREE.MeshBasicMaterial({ map: this.fxTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: e.appearance?.palette.aura ?? 0xffffff });
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
    const ground = this.game.map.tiles.heightAt(x, z);
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
    const anim = m.anims[s.anim] ? s.anim : m.anims.idle ? 'idle' : (Object.keys(m.anims)[0] as typeof s.anim);
    const def = m.anims[anim]!;
    const frame = frameAt(def, s.animTicks);
    // Directional billboard: travel direction while dashing/flying fast, otherwise facing.
    let facing = t.yaw;
    if (e.body && (s.anim === 'fly' || s.anim === 'dash' || s.anim === 'run' || s.anim === 'walk')) {
      const vx = e.body.vel.x;
      const vz = e.body.vel.z;
      if (vx * vx + vz * vz > 1) facing = Math.atan2(vx, vz);
    }
    const view = pickView(facing, camYaw, m.views);
    const col = m.columns[anim]! + frame;
    const W = m.totalColumns * m.frameWidth;
    const H = m.views.length * m.frameHeight;
    const u0 = (col * m.frameWidth) / W;
    const u1 = ((col + 1) * m.frameWidth) / W;
    const v1 = 1 - (view.row * m.frameHeight) / H;
    const v0 = 1 - ((view.row + 1) * m.frameHeight) / H;
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
    v.mat.color.setRGB(flash * tf, flash * (s.transformed ? 1.15 : 1), flash);
    v.mat.opacity = s.alpha;
    if (v.aura && v.auraMat) {
      v.aura.visible = s.aura;
      if (s.aura) {
        v.auraMat.color.set(s.transformed ? 0xffe04a : (e.appearance?.palette.aura ?? 0xffffff));
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

  sync(alpha: number, dt: number): void {
    this.time += dt;
    this.buildMap();
    this.atlases.pump();
    const g = this.game;
    const rig = g.camera;
    rig.resolve((x, z) => g.map.tiles.heightAt(x, z));
    this.camera.position.set(rig.position.x, rig.position.y, rig.position.z);
    this.camera.lookAt(rig.lookAt.x, rig.lookAt.y, rig.lookAt.z);
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
        const mat = new THREE.MeshBasicMaterial({ map: this.fxTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        const mesh = new THREE.Mesh(makeCenteredQuad(), mat);
        mesh.renderOrder = 6;
        this.scene.add(mesh);
        pv = { mesh, mat, frames: pr.visual === 'ki_wave' ? FX.kiWave : pr.visual === 'ki_charged' ? FX.kiCharged : FX.kiBall };
        this.projViews.set(e.id, pv);
      }
      const t = e.transform;
      pv.mesh.position.set(t.prev.x + (t.pos.x - t.prev.x) * alpha, t.prev.y + (t.pos.y - t.prev.y) * alpha, t.prev.z + (t.pos.z - t.prev.z) * alpha);
      pv.mesh.quaternion.copy(this.camera.quaternion);
      const sz = pr.radius * 3;
      pv.mesh.scale.set(sz, sz, 1);
      this.setFxUv(pv.mesh.geometry, pv.frames[Math.floor(this.time * 12) % pv.frames.length]);
      if (Math.random() < 0.3) this.spawnFx(FX.dust, pv.mesh.position.x, pv.mesh.position.y, pv.mesh.position.z, { size: sz * 0.5, life: 0.2, color: 0x9ad8ff });
    }
    for (const [id, pv] of [...this.projViews]) {
      if (pseen.has(id)) continue;
      this.scene.remove(pv.mesh);
      pv.mesh.geometry.dispose();
      pv.mat.dispose();
      this.projViews.delete(id);
    }

    this.updateFx(dt);
    this.updateMarkers(battle, alpha);
    this.updateDebug(battle);
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
  }
}

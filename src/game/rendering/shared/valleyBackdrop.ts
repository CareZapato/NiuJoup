import { Asset } from 'expo-asset';
import * as THREE from 'three';
import type { TileMap } from '../../world/TileMap';
import cieloUrl from '../../../../assets/generated/sprites/Nuevos/Entorno/cielo.png';
import cliffUrl from '../../../../assets/generated/sprites/Nuevos/Entorno/riscos.png';
import hillsUrl from '../../../../assets/generated/sprites/Nuevos/Entorno/colinas_medias.png';
import propsUrl from '../../../../assets/generated/sprites/Nuevos/Entorno/fachadas.png';
import mountainsUrl from '../../../../assets/generated/sprites/Nuevos/Entorno/montanas_lejanas.png';
import groundUrl from '../../../../assets/generated/sprites/Nuevos/Entorno/suelo.png';
import { patchWorld } from './worldGrade';

/** Quad with its origin at the bottom center, facing +Z. */
function horizonQuad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 1, 0, 0.5, 1, 0, -0.5, 0, 0, 0.5, 0, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
  g.setIndex([0, 2, 1, 2, 3, 1]);
  return g;
}

function finishTexture(tex: THREE.Texture, repeat: boolean): THREE.Texture {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = false;
  tex.flipY = true;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export async function loadSheet(moduleId: number, repeat: boolean): Promise<{ tex: THREE.Texture; img: HTMLImageElement | null } | null> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) return null;
  const tex = new THREE.Texture();
  let img: HTMLImageElement | null = null;
  if (typeof Image !== 'undefined') {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(uri));
      el.src = uri;
    });
    tex.image = img;
  } else if (asset.localUri?.startsWith('file://')) {
    tex.image = { localUri: asset.localUri, width: asset.width || 1024, height: asset.height || 512 } as THREE.Texture['image'];
  } else {
    return null;
  }
  return { tex: finishTexture(tex, repeat), img };
}

interface Layer {
  mesh: THREE.Mesh;
  distance: number;
  /** 1 = glued to the camera, 0 = glued to the world. */
  follow: number;
  drift: number;
}

interface Dressing {
  mesh: THREE.Mesh;
  sway: boolean;
}

/**
 * Painted horizon behind the valley. The layers lag the camera at different
 * rates, the clouds scroll, and the near hills breathe. Nothing here collides.
 */
export class ValleyBackdrop {
  private layers: Layer[] = [];
  private dressing: Dressing[] = [];
  private water: THREE.Texture | null = null;
  private propsTex: THREE.Texture | null = null;
  private treeUv = { u0: 0.75, v0: 0.5, u1: 1, v1: 1 };
  private slices: THREE.Texture[] = [];
  private solids: THREE.Object3D[] = [];
  private tiles: TileMap | null = null;
  private propsImg: HTMLImageElement | null = null;
  private cliffTex: THREE.Texture | null = null;
  private disposed = false;

  /**
   * Where the wall ends, measured from the bottom of each 256px cell in fachadas.png.
   * Above that line is the roof, the dome or the bridge rail.
   */
  private static readonly SPLIT = [0.59, 0.59, 0.59, 1, 1, 1, 1, 0.625];

  constructor(private scene: THREE.Scene) {
    void this.load();
  }

  /** Painted river tile, once it has loaded. The caller keeps scrolling its offset. */
  takeWater(): THREE.Texture | null {
    return this.water;
  }

  /** Shared facade sheet. The forest billboards sample the tree cell from it. */
  takeProps(): THREE.Texture | null {
    return this.propsTex;
  }

  /** Opaque bounds of the painted tree, so the billboard is the tree and not the empty cell. */
  takeTreeUv(): { u0: number; v0: number; u1: number; v1: number } | null {
    return this.propsTex ? this.treeUv : null;
  }

  /** Rebuilds houses, rocks, fences, the bridge and cliff faces for this map. */
  dressMap(tiles: TileMap): void {
    this.tiles = tiles;
    this.rebuild();
  }

  /** Sky and hill tint, plus the night glow of house windows. */
  setGrade(r: number, g: number, b: number, windowGlow: number): void {
    for (const layer of this.layers) {
      const mat = layer.mesh.material as THREE.MeshBasicMaterial;
      mat.color.setRGB(r, g, b);
    }
    for (const obj of this.solids) {
      obj.traverse((node) => {
        if (node.userData.kind !== 'window') return;
        const mat = (node as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.opacity = windowGlow;
      });
    }
  }

  update(camX: number, camZ: number, focusX: number, focusZ: number, yaw: number, time: number, reducedMotion: boolean): void {
    const pace = reducedMotion ? 0.15 : 1;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    for (const layer of this.layers) {
      const ax = focusX * layer.follow + camX * (1 - layer.follow);
      const az = focusZ * layer.follow + camZ * (1 - layer.follow);
      const sway = layer.distance < 50 ? Math.sin(time * 0.45 + layer.distance) * 0.35 * pace : 0;
      layer.mesh.position.set(ax + fx * layer.distance + Math.cos(yaw) * sway, layer.mesh.position.y, az + fz * layer.distance - Math.sin(yaw) * sway);
      layer.mesh.rotation.y = yaw;
      const map = layer.mesh.material instanceof THREE.MeshBasicMaterial ? layer.mesh.material.map : null;
      if (map && layer.drift) map.offset.x = time * layer.drift * pace;
    }
    for (const item of this.dressing) {
      item.mesh.rotation.y = yaw;
      if (!item.sway) continue;
      const s = 1 + Math.sin(time * 1.3 + item.mesh.position.x) * 0.018 * pace;
      item.mesh.scale.y = item.mesh.userData.baseH * s;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const layer of this.layers) {
      this.scene.remove(layer.mesh);
      layer.mesh.geometry.dispose();
      const mat = layer.mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    for (const item of this.dressing) {
      this.scene.remove(item.mesh);
      item.mesh.geometry.dispose();
      (item.mesh.material as THREE.Material).dispose();
    }
    this.water?.dispose();
    this.propsTex?.dispose();
    this.cliffTex?.dispose();
    for (const tex of this.slices) tex.dispose();
    for (const obj of this.solids) {
      this.scene.remove(obj);
      obj.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) mat.dispose();
      });
    }
    this.layers = [];
    this.dressing = [];
    this.slices = [];
    this.solids = [];
  }

  private async load(): Promise<void> {
    try {
      const [sky, mountains, hills, props, ground, cliffs] = await Promise.all([
        loadSheet(cieloUrl, true),
        loadSheet(mountainsUrl, true),
        loadSheet(hillsUrl, true),
        loadSheet(propsUrl, false),
        loadSheet(groundUrl, false),
        loadSheet(cliffUrl, false),
      ]);
      if (this.disposed) {
        for (const item of [sky, mountains, hills, props, ground, cliffs]) item?.tex.dispose();
        return;
      }
      if (cliffs) this.cliffTex = cliffs.tex;
      if (sky) this.addLayer(sky.tex, 42, 0.98, 160, 28, 0.4, -30, 0.006, false);
      if (mountains) this.addLayer(mountains.tex, 34, 0.84, 130, 14, 0, -20, 0.001, true);
      if (hills) this.addLayer(hills.tex, 26, 0.58, 110, 12, 0, -10, 0, true);
      if (props) {
        this.propsTex = props.tex;
        this.propsImg = props.img;
        this.rebuild();
      }
      if (ground?.img) this.water = this.cropWater(ground.img);
      ground?.tex.dispose();
    } catch (err) {
      console.warn('No se pudo cargar el horizonte pintado.', err);
    }
  }

  private addLayer(map: THREE.Texture, distance: number, follow: number, width: number, height: number, baseY: number, order: number, drift: number, transparent: boolean): void {
    const mat = new THREE.MeshBasicMaterial({
      map,
      // Opaque pass, drawn before the valley. The world then covers these pixels.
      transparent: false,
      alphaTest: transparent ? 0.35 : 0,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(horizonQuad(), mat);
    mesh.scale.set(width, height, 1);
    mesh.position.y = baseY;
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.layers.push({ mesh, distance, follow, drift });
  }

  private rebuild(): void {
    this.clearSolids();
    const tex = this.propsTex;
    const img = this.propsImg;
    const tiles = this.tiles;
    if (!tex || !tiles) return;
    this.treeUv = cellContent(img, 3, true);
    const wall = (cell: number, tint = 0xffffff, u0 = 0, u1 = 1) => this.faceMat(tex, img, cell, 0, ValleyBackdrop.SPLIT[cell], tint, u0, u1);
    const roof = (cell: number, tint = 0xffffff) => this.faceMat(tex, img, cell, ValleyBackdrop.SPLIT[cell], 1, tint);
    const full = (cell: number, tint = 0xffffff) => this.faceMat(tex, img, cell, 0, 1, tint);
    this.addSolid(this.capsuleHouse(7, 5.5, wall(0), roof(0)));
    this.addSolid(this.squareHouse(15.5, 5.5, wall(1), wall(1, 0xffffff, 0.4, 0.62), roof(1)));
    this.addSolid(this.roundHouse(6, 12.5, wall(2), roof(2), wall(2, 0xffffff, 0.66, 0.92)));
    this.addFences(tiles, full(6));
    this.addRocks(tiles, full(4));
    this.addBridge(tiles, wall(7), roof(7));
    this.addCliffs(tiles, this.cliffTex ? patchWorld(new THREE.MeshBasicMaterial({ map: this.cliffTex, fog: false })) : full(5));
  }

  private clearSolids(): void {
    for (const obj of this.solids) {
      this.scene.remove(obj);
      obj.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) mat.dispose();
      });
    }
    for (const slice of this.slices) slice.dispose();
    this.solids = [];
    this.slices = [];
  }

  private addSolid(obj: THREE.Object3D): void {
    this.scene.add(obj);
    this.solids.push(obj);
  }

  /** Crops the opaque pixels of a facade cell onto a face. y0/y1 are fractions of that crop, bottom to top. */
  private faceMat(tex: THREE.Texture, img: HTMLImageElement | null, cell: number, y0: number, y1: number, tint: number, u0 = 0, u1 = 1): THREE.MeshBasicMaterial {
    const b = cellContent(img, cell);
    const slice = tex.clone();
    const vLo = b.v0 + (b.v1 - b.v0) * y0;
    const vHi = b.v0 + (b.v1 - b.v0) * y1;
    const uu0 = b.u0 + (b.u1 - b.u0) * u0;
    const uu1 = b.u0 + (b.u1 - b.u0) * u1;
    slice.offset.set(uu0, vLo);
    slice.repeat.set(Math.max(0.001, uu1 - uu0), Math.max(0.001, vHi - vLo));
    slice.wrapS = slice.wrapT = THREE.ClampToEdgeWrapping;
    slice.needsUpdate = true;
    this.slices.push(slice);
    return patchWorld(new THREE.MeshBasicMaterial({ map: slice, color: tint, alphaTest: 0.2, fog: false }));
  }

  private capsuleHouse(x: number, z: number, wall: THREE.Material, domeMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.55, 1.7, 10), wall);
    body.position.y = 0.85;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.45, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.y = 1.7;
    g.add(body, dome);
    // Porthole sits on the +X side of the wrapped metal, not on the front face.
    const porthole = 0.26 * Math.PI * 2;
    this.addWindow(g, Math.sin(porthole) * 1.58, 1, Math.cos(porthole) * 1.58, 0.5, 0.48, porthole);
    g.position.set(x, 0, z);
    return g;
  }

  /** Rectangular dojo: a box, with the tile band on a slab that overhangs the walls. */
  private squareHouse(x: number, z: number, front: THREE.Material, side: THREE.Material, roofMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    // Top is tile, not the wall, so the shoji grids never land on the roof.
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.05, 2.5), [side, side, roofMat, side, front, front]);
    body.position.y = 1.02;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.78, 3.05), roofMat);
    roof.position.y = 2.4;
    g.add(body, roof);
    const winY = 1.08;
    const winW = 1.05;
    const winH = 0.58;
    this.addWindow(g, -1.58, winY, 1.28, winW, winH);
    this.addWindow(g, 1.58, winY, 1.28, winW, winH);
    this.addWindow(g, -1.58, winY, -1.28, winW, winH, Math.PI);
    this.addWindow(g, 1.58, winY, -1.28, winW, winH, Math.PI);
    g.position.set(x, 0, z);
    return g;
  }

  private roundHouse(x: number, z: number, wall: THREE.Material, roofMat: THREE.Material, side: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.45, 1.65, 8), wall);
    body.position.y = 0.82;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.85, 1.35, 8), roofMat);
    cap.position.y = 2.15;
    const stucco = patchWorld(new THREE.MeshBasicMaterial({ color: 0xf3e0c0, fog: false }));
    const lean = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.15, 0.7), [stucco, stucco, roofMat, stucco, side, stucco]);
    lean.position.set(1.55, 0.58, 0.4);
    g.add(body, cap, lean);
    const pane = 0.78 * Math.PI * 2;
    this.addWindow(g, Math.sin(pane) * 1.48, 0.93, Math.cos(pane) * 1.48, 0.62, 0.4, pane);
    this.addWindow(g, 1.51, 0.66, 0.78, 0.32, 0.34);
    g.position.set(x, 0, z);
    return g;
  }

  private addWindow(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, yaw = 0): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffcc77,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.userData.kind = 'window';
    mesh.renderOrder = 3;
    parent.add(mesh);
  }

  private addFences(tiles: TileMap, mat: THREE.Material): void {
    const along = new THREE.BoxGeometry(1, 0.72, 0.16);
    const across = new THREE.BoxGeometry(0.16, 0.72, 1);
    const xMesh = new THREE.InstancedMesh(along, mat, 1);
    const zMesh = new THREE.InstancedMesh(across, mat, 1);
    const xMats: THREE.Matrix4[] = [];
    const zMats: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    for (let z = 0; z < tiles.height; z++) {
      for (let x = 0; x < tiles.width; x++) {
        if (tiles.charAt(x, z) !== 'F') continue;
        const horizontal = tiles.charAt(x - 1, z) === 'F' || tiles.charAt(x + 1, z) === 'F';
        p.set(x + 0.5, 0.36, z + 0.5);
        m.compose(p, q, s);
        (horizontal ? xMats : zMats).push(m.clone());
      }
    }
    this.addInstances(xMesh, xMats);
    this.addInstances(zMesh, zMats);
  }

  private addRocks(tiles: TileMap, mat: THREE.Material): void {
    const geo = new THREE.BoxGeometry(0.95, 0.78, 0.82);
    const mesh = new THREE.InstancedMesh(geo, mat, 1);
    const mats: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    for (let z = 0; z < tiles.height; z++) {
      for (let x = 0; x < tiles.width; x++) {
        if (tiles.charAt(x, z) !== 'o') continue;
        p.set(x + 0.5, 0.39, z + 0.5);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((x * 13 + z * 7) % 10) * 0.2);
        s.set(0.85 + (x % 3) * 0.12, 0.9, 0.85 + (z % 3) * 0.1);
        m.compose(p, q, s);
        mats.push(m.clone());
      }
    }
    this.addInstances(mesh, mats);
  }

  private addBridge(tiles: TileMap, deckMat: THREE.Material, railMat: THREE.Material): void {
    let minX = tiles.width;
    let maxX = -1;
    let minZ = tiles.height;
    let maxZ = -1;
    for (let z = 0; z < tiles.height; z++) {
      for (let x = 0; x < tiles.width; x++) {
        if (tiles.charAt(x, z) !== '=') continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    if (maxX < 0) return;
    const w = maxX - minX + 1;
    const d = maxZ - minZ + 1;
    const cx = minX + w / 2;
    const cz = minZ + d / 2;
    const g = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), deckMat);
    deck.position.y = 0.12;
    const railA = new THREE.Mesh(new THREE.BoxGeometry(w, 0.42, 0.12), railMat);
    const railB = new THREE.Mesh(new THREE.BoxGeometry(w, 0.42, 0.12), railMat);
    railA.position.set(0, 0.4, d / 2 - 0.08);
    railB.position.set(0, 0.4, -d / 2 + 0.08);
    g.add(deck, railA, railB);
    g.position.set(cx, 0, cz);
    this.addSolid(g);
  }

  private addCliffs(tiles: TileMap, mat: THREE.Material): void {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const nudge = 0.06;
    const push = (a: number[], b: number[], c: number[], dgt: number[], cell: number) => {
      const base = pos.length / 3;
      for (const p of [a, b, c, dgt]) pos.push(p[0], p[1], p[2]);
      const col = cell % 8;
      const row = Math.floor(cell / 8);
      const u0 = col / 8;
      const u1 = (col + 1) / 8;
      const v1 = 1 - row / 2;
      const v0 = 1 - (row + 1) / 2;
      uv.push(u0, v1, u1, v1, u0, v0, u1, v0);
      idx.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    };
    const bands: { char: string; h: number }[] = [
      { char: '^', h: 2.6 },
      { char: 'P', h: 1.1 },
    ];
    for (const band of bands) {
      for (let z = 0; z < tiles.height; z++) {
        for (let x = 0; x < tiles.width; x++) {
          if (tiles.charAt(x, z) !== band.char) continue;
          const hh = band.h;
          if (tiles.charAt(x, z + 1) !== band.char) push([x, hh, z + 1 + nudge], [x + 1, hh, z + 1 + nudge], [x, 0, z + 1 + nudge], [x + 1, 0, z + 1 + nudge], (x * 3 + z) % 16);
          if (tiles.charAt(x, z - 1) !== band.char) push([x + 1, hh, z - nudge], [x, hh, z - nudge], [x + 1, 0, z - nudge], [x, 0, z - nudge], (x * 5 + z + 1) % 16);
          if (tiles.charAt(x + 1, z) !== band.char) push([x + 1 + nudge, hh, z + 1], [x + 1 + nudge, hh, z], [x + 1 + nudge, 0, z + 1], [x + 1 + nudge, 0, z], (x * 7 + z + 2) % 16);
          if (tiles.charAt(x - 1, z) !== band.char) push([x - nudge, hh, z], [x - nudge, hh, z + 1], [x - nudge, 0, z], [x - nudge, 0, z + 1], (x * 11 + z + 3) % 16);
        }
      }
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.addSolid(new THREE.Mesh(geo, mat));
  }

  private addInstances(mesh: THREE.InstancedMesh, matrices: THREE.Matrix4[]): void {
    if (!matrices.length) {
      mesh.geometry.dispose();
      return;
    }
    const placed = new THREE.InstancedMesh(mesh.geometry, mesh.material, matrices.length);
    matrices.forEach((mat, i) => placed.setMatrixAt(i, mat));
    placed.instanceMatrix.needsUpdate = true;
    this.addSolid(placed);
  }

  /** The ground sheet is six tall panels. The fifth is the water. */
  private cropWater(img: HTMLImageElement): THREE.Texture | null {
    if (typeof document === 'undefined') return null;
    const cols = 6;
    const colW = img.width / cols;
    const size = Math.floor(Math.min(colW, img.height) * 0.72);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const sx = 4 * colW + (colW - size) / 2;
    const sy = (img.height - size) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, sx, sy, size, size, 0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }
}

function cellContent(img: HTMLImageElement | null, cell: number, skipDark = false): { u0: number; v0: number; u1: number; v1: number } {
  const cols = 4;
  const rows = 2;
  const c = cell % cols;
  const r = Math.floor(cell / cols);
  const full = { u0: c / cols, u1: (c + 1) / cols, v0: 1 - (r + 1) / rows, v1: 1 - r / rows };
  if (!img || typeof document === 'undefined') return full;
  const cw = img.width / cols;
  const ch = img.height / rows;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(cw));
  canvas.height = Math.max(1, Math.floor(ch));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return full;
  ctx.drawImage(img, c * cw, r * ch, cw, ch, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (data[i + 3] <= 24) continue;
      if (skipDark && data[i] < 46 && data[i + 1] < 46 && data[i + 2] < 46) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return full;
  if (skipDark) {
    minX = Math.min(maxX, minX + 2);
    minY = Math.min(maxY, minY + 2);
    maxX = Math.max(minX, maxX - 2);
    maxY = Math.max(minY, maxY - 2);
  }
  return {
    u0: (c + minX / canvas.width) / cols,
    u1: (c + (maxX + 1) / canvas.width) / cols,
    v1: 1 - (r + minY / canvas.height) / rows,
    v0: 1 - (r + (maxY + 1) / canvas.height) / rows,
  };
}

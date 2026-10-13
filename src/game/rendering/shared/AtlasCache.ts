import { Asset } from 'expo-asset';
import * as THREE from 'three';
import gokuPng from '../../../../assets/generated/sprites/char_kaien_hero.png';
import gokuManifestJson from '../../../../assets/generated/sprites/char_kaien_hero.json';
import krillinPng from '../../../../assets/generated/sprites/char_oren_hero.png';
import krillinManifestJson from '../../../../assets/generated/sprites/char_oren_hero.json';
import yamchaPng from '../../../../assets/generated/sprites/char_suri_hero.png';
import yamchaManifestJson from '../../../../assets/generated/sprites/char_suri_hero.json';
import hokuPng from '../../../../assets/generated/sprites/npc_master_hero.png';
import hokuManifestJson from '../../../../assets/generated/sprites/npc_master_hero.json';
import miraPng from '../../../../assets/generated/sprites/npc_villager_hero.png';
import miraManifestJson from '../../../../assets/generated/sprites/npc_villager_hero.json';
import bramPng from '../../../../assets/generated/sprites/npc_smith_hero.png';
import bramManifestJson from '../../../../assets/generated/sprites/npc_smith_hero.json';
import sproutPng from '../../../../assets/generated/sprites/enemy_sprout_hero.png';
import sproutManifestJson from '../../../../assets/generated/sprites/enemy_sprout_hero.json';
import banditPng from '../../../../assets/generated/sprites/enemy_bandit_hero.png';
import banditManifestJson from '../../../../assets/generated/sprites/enemy_bandit_hero.json';
import dinoPng from '../../../../assets/generated/sprites/enemy_golem_hero.png';
import dinoManifestJson from '../../../../assets/generated/sprites/enemy_golem_hero.json';
import { CHARACTERS, ENEMIES, NPC_APPEARANCES } from '../../content/characters';
import type { AppearanceDef } from '../../content/types';
import { generateCharacterAtlas } from './characterArt';
import { generateHeroAtlas, isHeroAppearance } from './heroArt';
import { frameRect, type SpriteManifest } from './manifest';
import type { Tex } from './worldArt';

const gokuManifest = gokuManifestJson as SpriteManifest;
const krillinManifest = krillinManifestJson as SpriteManifest;
const yamchaManifest = yamchaManifestJson as SpriteManifest;
const hokuManifest = hokuManifestJson as SpriteManifest;
const miraManifest = miraManifestJson as SpriteManifest;
const bramManifest = bramManifestJson as SpriteManifest;
const sproutManifest = sproutManifestJson as SpriteManifest;
const banditManifest = banditManifestJson as SpriteManifest;
const dinoManifest = dinoManifestJson as SpriteManifest;

export function makeTexture(t: Tex, repeat = false): THREE.DataTexture {
  const tex = new THREE.DataTexture(t.data, t.width, t.height, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export interface Atlas {
  texture: THREE.Texture;
  manifest: SpriteManifest;
}

export function appearanceFor(atlasId: string): AppearanceDef | null {
  const [kind, id] = atlasId.split(':');
  if (kind === 'char') return CHARACTERS[id]?.appearance ?? null;
  if (kind === 'enemy') return ENEMIES[id]?.appearance ?? null;
  if (kind === 'npc') return NPC_APPEARANCES[id] ?? null;
  return null;
}

/**
 * Lazily generates character atlases (world + battle). Prefetch requests are
 * processed one per frame so loading is incremental and never causes a long
 * hitch when an encounter begins.
 */
export class AtlasCache {
  /** Bumps when a painted atlas replaces the procedural one, so sprites rebind. */
  epoch = 0;
  private cache = new Map<string, Atlas>();
  private queue: string[] = [];
  private painted = new Map<string, Atlas>();
  private disposed = false;
  private static readonly GOKU = 'char:kaien|hero';
  private static readonly KRILLIN = 'char:oren|hero';
  private static readonly YAMCHA = 'char:suri|hero';

  constructor() {
    void this.loadPainted(AtlasCache.GOKU, gokuPng, gokuManifest, 'Goku');
    void this.loadPainted(AtlasCache.KRILLIN, krillinPng, krillinManifest, 'Krillin');
    void this.loadPainted(AtlasCache.YAMCHA, yamchaPng, yamchaManifest, 'Yamcha');
    void this.loadPainted('npc:master|hero', hokuPng, hokuManifest, 'Maestro Hoku');
    void this.loadPainted('npc:villager|hero', miraPng, miraManifest, 'Aldeana Mira');
    void this.loadPainted('npc:smith|hero', bramPng, bramManifest, 'Herrero Bram');
    void this.loadPainted('enemy:sprout|hero', sproutPng, sproutManifest, 'Brote salvaje');
    void this.loadPainted('enemy:bandit|hero', banditPng, banditManifest, 'Bandido del valle');
    void this.loadPainted('enemy:golem|hero', dinoPng, dinoManifest, 'Dinosaurio del risco');
  }

  key(atlasId: string, mode: 'world' | 'battle'): string {
    return `${atlasId}|${mode}`;
  }

  get(atlasId: string, mode: 'world' | 'battle'): Atlas | null {
    const app = appearanceFor(atlasId);
    if (!app) return null;
    const painted = this.painted.get(`${atlasId}|hero`);
    if (painted) return painted;
    // Heroes use one detailed atlas for both modes.
    const k = isHeroAppearance(app) ? `${atlasId}|hero` : this.key(atlasId, mode);
    let a = this.cache.get(k);
    if (a) return a;
    const gen = isHeroAppearance(app) ? generateHeroAtlas(atlasId, app) : generateCharacterAtlas(atlasId, app, mode);
    const texture = makeTexture(gen);
    // Linear minification keeps 96 px sprites stable (no shimmer) when drawn smaller; magnification stays nearest.
    if (isHeroAppearance(app)) texture.minFilter = THREE.LinearFilter;
    a = { texture, manifest: gen.manifest };
    this.cache.set(k, a);
    return a;
  }

  has(atlasId: string, mode: 'world' | 'battle'): boolean {
    const app = appearanceFor(atlasId);
    return this.cache.has(app && isHeroAppearance(app) ? `${atlasId}|hero` : this.key(atlasId, mode));
  }

  prefetch(atlasId: string, mode: 'world' | 'battle'): void {
    const app = appearanceFor(atlasId);
    const k = app && isHeroAppearance(app) ? `${atlasId}|hero` : this.key(atlasId, mode);
    if (!this.cache.has(k) && !this.queue.includes(k)) this.queue.push(k);
  }

  /** Generates at most one queued atlas. Returns true if work was done. */
  pump(): boolean {
    const k = this.queue.shift();
    if (!k) return false;
    const [atlasId, mode] = k.split('|') as [string, 'world' | 'battle' | 'hero'];
    this.get(atlasId, mode === 'hero' ? 'battle' : mode);
    return true;
  }

  get pending(): number {
    return this.queue.length;
  }

  dispose(): void {
    this.disposed = true;
    for (const a of this.cache.values()) a.texture.dispose();
    this.cache.clear();
    this.painted.clear();
  }

  /** Painted hero sheet. Until the PNG loads, the procedural atlas stays on screen. */
  private async loadPainted(key: string, moduleId: number, manifest: SpriteManifest, name: string): Promise<void> {
    try {
      const asset = Asset.fromModule(moduleId);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (!uri) return;
      const texture = new THREE.Texture();
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.premultiplyAlpha = false;
      texture.flipY = true;
      if (typeof Image !== 'undefined') {
        texture.image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(uri));
          img.src = uri;
        });
      } else if (asset.localUri?.startsWith('file://')) {
        const size = frameRect(manifest, 0, 0);
        texture.image = { localUri: asset.localUri, width: asset.width || size.atlasW, height: asset.height || size.atlasH } as THREE.Texture['image'];
      } else {
        return;
      }
      texture.needsUpdate = true;
      if (this.disposed) {
        texture.dispose();
        return;
      }
      const next = { texture, manifest };
      const prev = this.cache.get(key);
      if (prev && prev !== this.painted.get(key)) prev.texture.dispose();
      this.painted.set(key, next);
      this.cache.set(key, next);
      this.epoch++;
    } catch (err) {
      console.warn(`No se pudo cargar el atlas pintado de ${name}; se usa el procedural.`, err);
    }
  }
}

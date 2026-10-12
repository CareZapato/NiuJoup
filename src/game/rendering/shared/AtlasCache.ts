import { Asset } from 'expo-asset';
import * as THREE from 'three';
import gokuPng from '../../../../assets/generated/sprites/char_kaien_hero.png';
import gokuManifestJson from '../../../../assets/generated/sprites/char_kaien_hero.json';
import krillinPng from '../../../../assets/generated/sprites/char_oren_hero.png';
import krillinManifestJson from '../../../../assets/generated/sprites/char_oren_hero.json';
import { CHARACTERS, ENEMIES, NPC_APPEARANCES } from '../../content/characters';
import type { AppearanceDef } from '../../content/types';
import { generateCharacterAtlas } from './characterArt';
import { generateHeroAtlas, isHeroAppearance } from './heroArt';
import { frameRect, type SpriteManifest } from './manifest';
import type { Tex } from './worldArt';

const gokuManifest = gokuManifestJson as SpriteManifest;
const krillinManifest = krillinManifestJson as SpriteManifest;

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

  constructor() {
    void this.loadPainted(AtlasCache.GOKU, gokuPng, gokuManifest, 'Goku');
    void this.loadPainted(AtlasCache.KRILLIN, krillinPng, krillinManifest, 'Krillin');
  }

  key(atlasId: string, mode: 'world' | 'battle'): string {
    return `${atlasId}|${mode}`;
  }

  get(atlasId: string, mode: 'world' | 'battle'): Atlas | null {
    const app = appearanceFor(atlasId);
    if (!app) return null;
    // Heroes use one detailed atlas for both modes.
    const k = isHeroAppearance(app) ? `${atlasId}|hero` : this.key(atlasId, mode);
    const painted = this.painted.get(k);
    if (painted) return painted;
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

  /** Painted hero sheet. Yamcha stays procedural until his sheets exist. */
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

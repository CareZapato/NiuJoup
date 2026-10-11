import * as THREE from 'three';
import { CHARACTERS, ENEMIES, NPC_APPEARANCES } from '../../content/characters';
import type { AppearanceDef } from '../../content/types';
import { generateCharacterAtlas } from './characterArt';
import type { SpriteManifest } from './manifest';
import type { Tex } from './worldArt';

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
  texture: THREE.DataTexture;
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
  private cache = new Map<string, Atlas>();
  private queue: string[] = [];

  key(atlasId: string, mode: 'world' | 'battle'): string {
    return `${atlasId}|${mode}`;
  }

  get(atlasId: string, mode: 'world' | 'battle'): Atlas | null {
    const k = this.key(atlasId, mode);
    let a = this.cache.get(k);
    if (a) return a;
    const app = appearanceFor(atlasId);
    if (!app) return null;
    const gen = generateCharacterAtlas(atlasId, app, mode);
    a = { texture: makeTexture(gen), manifest: gen.manifest };
    this.cache.set(k, a);
    return a;
  }

  has(atlasId: string, mode: 'world' | 'battle'): boolean {
    return this.cache.has(this.key(atlasId, mode));
  }

  prefetch(atlasId: string, mode: 'world' | 'battle'): void {
    const k = this.key(atlasId, mode);
    if (!this.cache.has(k) && !this.queue.includes(k)) this.queue.push(k);
  }

  /** Generates at most one queued atlas. Returns true if work was done. */
  pump(): boolean {
    const k = this.queue.shift();
    if (!k) return false;
    const [atlasId, mode] = k.split('|') as [string, 'world' | 'battle'];
    this.get(atlasId, mode);
    return true;
  }

  get pending(): number {
    return this.queue.length;
  }

  dispose(): void {
    for (const a of this.cache.values()) a.texture.dispose();
    this.cache.clear();
  }
}

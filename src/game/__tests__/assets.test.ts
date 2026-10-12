import { describe, expect, it } from 'vitest';
import { CHARACTERS, ENEMIES, NPC_APPEARANCES } from '../content/characters';
import type { AppearanceDef } from '../content/types';
import { toTopDown, validateAtlas } from '../rendering/shared/assetValidation';
import { generateCharacterAtlas } from '../rendering/shared/characterArt';
import { generateHeroAtlas, isHeroAppearance } from '../rendering/shared/heroArt';
import { frameRect, pickView } from '../rendering/shared/manifest';
import { AdaptiveDpr, targetDpr } from '../rendering/shared/resolution';
import { generateEffects, generateProps, generateTerrainAtlas } from '../rendering/shared/worldArt';

const SOURCES: [string, string, AppearanceDef][] = [
  ...Object.values(CHARACTERS).map((c): [string, string, AppearanceDef] => ['char', c.id, c.appearance]),
  ...Object.values(ENEMIES).map((e): [string, string, AppearanceDef] => ['enemy', e.id, e.appearance]),
  ...Object.entries(NPC_APPEARANCES).map(([id, a]): [string, string, AppearanceDef] => ['npc', id, a]),
];

describe('generated placeholder sprites pass the asset validator', () => {
  for (const [kind, id, app] of SOURCES) {
    for (const mode of ['world', 'battle'] as const) {
      it(`${kind}_${id}_${mode}`, () => {
        const a = generateCharacterAtlas(`${kind}:${id}`, app, mode);
        const issues = validateAtlas(`${kind}_${id}_${mode}`, a.manifest, { width: a.width, height: a.height, rgba: toTopDown(a.width, a.height, a.data) });
        expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
      });
    }
  }
});

describe('hero atlases (Goku, Krillin, Yamcha)', () => {
  const heroes = Object.values(CHARACTERS).filter((c) => isHeroAppearance(c.appearance));
  const atlas = (id: string) => {
    const app = CHARACTERS[id]!.appearance;
    if (!isHeroAppearance(app)) throw new Error(id);
    return generateHeroAtlas(`char:${id}`, app);
  };
  /** Opaque height of the S-view idle frame, in pixels. */
  const idleHeight = (id: string): number => {
    const a = atlas(id);
    const img = toTopDown(a.width, a.height, a.data);
    const r = frameRect(a.manifest, a.manifest.columns.idle!, 0);
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < a.manifest.frameHeight; y++) {
      for (let x = 0; x < a.manifest.frameWidth; x++) {
        if (img[((r.y + y) * a.width + r.x + x) * 4 + 3]! > 0) {
          if (top < 0) top = y;
          bottom = y;
        }
      }
    }
    return bottom - top + 1;
  };

  it('all three playable heroes use the detailed atlas', () => {
    expect(heroes.map((c) => c.name).sort()).toEqual(['Goku', 'Krillin', 'Yamcha']);
  });

  for (const id of ['kaien', 'oren', 'suri']) {
    it(`char_${id}_hero passes the validator, fits 2048 px and has technique release events`, () => {
      const a = atlas(id);
      const issues = validateAtlas(`char_${id}_hero`, a.manifest, { width: a.width, height: a.height, rgba: toTopDown(a.width, a.height, a.data) });
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(a.width).toBeLessThanOrEqual(2048);
      expect(a.manifest.frameHeight).toBe(96);
      expect(a.manifest.views.length).toBeGreaterThanOrEqual(5);
      for (const anim of ['tech_kamehameha', 'tech_kienzan', 'tech_taiyoken', 'tech_sokidan', 'tech_wolf_fang', 'tech_kaioken', 'tech_teleport'] as const) {
        expect(a.manifest.anims[anim]?.events?.[1]).toBe('release');
      }
    });
  }

  it('Krillin is visibly shorter than Goku and Yamcha', () => {
    const goku = idleHeight('kaien');
    const krillin = idleHeight('oren');
    const yamcha = idleHeight('suri');
    expect(krillin).toBeLessThan(goku - 6);
    expect(krillin).toBeLessThan(yamcha - 6);
  });
});

describe('asset validator catches broken assets', () => {
  const a = generateCharacterAtlas('char:kaien', CHARACTERS.kaien.appearance, 'world');
  const img = () => ({ width: a.width, height: a.height, rgba: toTopDown(a.width, a.height, a.data) });

  it('bad names and wrong dimensions', () => {
    expect(validateAtlas('Kaien-World', a.manifest, img()).some((i) => i.message.includes('nombre'))).toBe(true);
    expect(validateAtlas('char_kaien_world', a.manifest, { ...img(), width: a.width - 32 }).some((i) => i.severity === 'error')).toBe(true);
  });

  it('empty frames and missing transparency', () => {
    const empty = img();
    for (let y = 0; y < 48; y++) empty.rgba.fill(0, y * empty.width * 4, (y * empty.width + 32) * 4);
    expect(validateAtlas('char_kaien_world', a.manifest, empty).some((i) => i.message.includes('vacío'))).toBe(true);
    const opaque = img();
    for (let i = 3; i < opaque.rgba.length; i += 4) opaque.rgba[i] = 255;
    expect(validateAtlas('char_kaien_world', a.manifest, opaque).some((i) => i.message.includes('transparencia'))).toBe(true);
  });
});

describe('adaptive internal resolution', () => {
  it('caps internal height at 1080 and never forces 1080p on phones', () => {
    // 1920x1080 desktop at DPR 1 renders 1:1.
    expect(targetDpr(1, 1080, false)).toBe(1);
    // 4K-ish laptop (DPR 2, 1080 css px tall) stays at 1080 internal rows.
    expect(targetDpr(2, 1080, false) * 1080).toBeCloseTo(1080);
    // Phone in landscape: 390 css px tall, DPR 3, low quality -> DPR 1 (390 rows), not 1080.
    expect(targetDpr(3, 390, true)).toBe(1);
    // A small window never drops below 540 internal rows unless the device cannot provide them.
    expect(targetDpr(2, 500, false) * 500).toBeGreaterThanOrEqual(540);
  });

  it('drops DPR under sustained low FPS and recovers with headroom', () => {
    const a = new AdaptiveDpr();
    for (let i = 0; i < 60; i++) a.sample(1 / 30);
    expect(a.factor).toBeLessThan(1);
    const low = a.factor;
    for (let i = 0; i < 240; i++) a.sample(1 / 60);
    expect(a.factor).toBeGreaterThan(low);
    expect(targetDpr(2, 1080, false, 0.5) * 1080).toBeGreaterThanOrEqual(540);
  });
});

describe('world art', () => {
  it('atlases have the documented sizes', () => {
    expect(generateTerrainAtlas()).toMatchObject({ width: 128, height: 64 });
    expect(generateProps()).toMatchObject({ width: 256, height: 32 });
    expect(generateEffects().width).toBe(256);
  });

  it('directional billboards mirror side views and keep front/back unmirrored', () => {
    const views = ['S', 'SE', 'E', 'NE', 'N'] as const;
    expect(pickView(0, 0, [...views])).toEqual({ row: 0, mirror: false });
    expect(pickView(Math.PI, 0, [...views])).toEqual({ row: 4, mirror: false });
    const right = pickView(Math.PI / 2, 0, [...views]);
    const left = pickView(-Math.PI / 2, 0, [...views]);
    expect(right.row).toBe(2);
    expect(left.row).toBe(2);
    expect(right.mirror).not.toBe(left.mirror);
  });
});

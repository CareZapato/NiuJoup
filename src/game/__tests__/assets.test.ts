import { describe, expect, it } from 'vitest';
import { CHARACTERS, ENEMIES, NPC_APPEARANCES } from '../content/characters';
import type { AppearanceDef } from '../content/types';
import { toTopDown, validateAtlas } from '../rendering/shared/assetValidation';
import { generateCharacterAtlas } from '../rendering/shared/characterArt';
import { pickView } from '../rendering/shared/manifest';
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

// Asset pipeline CLI.
//   npx tsx scripts/assets.ts export            -> assets/generated/** (PNG + manifest JSON)
//   npx tsx scripts/assets.ts validate [dirs..] -> validates every <name>.png + <name>.json pair
// Default validation dirs: assets/sprites (hand-made art) and assets/generated/sprites.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { buildGokuAtlas } from './build-goku-atlas';
import { buildKrillinAtlas } from './build-krillin-atlas';
import { buildYamchaAtlas } from './build-yamcha-atlas';
import { CHARACTERS, ENEMIES, NPC_APPEARANCES } from '../src/game/content/characters';
import type { AppearanceDef } from '../src/game/content/types';
import { type AssetIssue, toTopDown, validateAtlas } from '../src/game/rendering/shared/assetValidation';
import { generateCharacterAtlas } from '../src/game/rendering/shared/characterArt';
import { generateHeroAtlas, isHeroAppearance } from '../src/game/rendering/shared/heroArt';
import type { SpriteManifest } from '../src/game/rendering/shared/manifest';
import { generateEffects, generateProps, generateTerrainAtlas, generateTrees, generateWater, type Tex } from '../src/game/rendering/shared/worldArt';

const OUT = resolve('assets/generated');

function writePng(path: string, width: number, height: number, bottomUp: Uint8Array): void {
  const png = new PNG({ width, height });
  png.data = Buffer.from(toTopDown(width, height, bottomUp));
  writeFileSync(path, PNG.sync.write(png));
}

function exportAll(): void {
  mkdirSync(join(OUT, 'sprites'), { recursive: true });
  mkdirSync(join(OUT, 'world'), { recursive: true });
  const sources: [string, string, AppearanceDef][] = [
    ...Object.values(CHARACTERS).map((c): [string, string, AppearanceDef] => ['char', c.id, c.appearance]),
    ...Object.values(ENEMIES).map((e): [string, string, AppearanceDef] => ['enemy', e.id, e.appearance]),
    ...Object.entries(NPC_APPEARANCES).map(([id, a]): [string, string, AppearanceDef] => ['npc', id, a]),
  ];
  const index: { sprites: string[]; world: string[] } = { sprites: [], world: [] };
  for (const f of readdirSync(join(OUT, 'sprites'))) {
    const path = join(OUT, 'sprites', f);
    if (statSync(path).isDirectory()) continue;
    rmSync(path);
  }
  for (const [kind, id, app] of sources) {
    if (isHeroAppearance(app) && (app.hero === 'goku' || app.hero === 'krillin' || app.hero === 'yamcha')) {
      const painted = app.hero === 'goku' ? buildGokuAtlas() : app.hero === 'krillin' ? buildKrillinAtlas() : buildYamchaAtlas();
      if (painted) {
        const name = `${kind}_${id}_hero`;
        const png = new PNG({ width: painted.width, height: painted.height });
        png.data = Buffer.from(painted.rgba);
        writeFileSync(join(OUT, 'sprites', `${name}.png`), PNG.sync.write(png));
        writeFileSync(join(OUT, 'sprites', `${name}.json`), JSON.stringify(painted.manifest, null, 2));
        index.sprites.push(name);
        continue;
      }
    }
    if (isHeroAppearance(app)) {
      const a = generateHeroAtlas(`${kind}:${id}`, app);
      const name = `${kind}_${id}_hero`;
      writePng(join(OUT, 'sprites', `${name}.png`), a.width, a.height, a.data);
      writeFileSync(join(OUT, 'sprites', `${name}.json`), JSON.stringify(a.manifest, null, 2));
      index.sprites.push(name);
      continue;
    }
    for (const mode of ['world', 'battle'] as const) {
      const a = generateCharacterAtlas(`${kind}:${id}`, app, mode);
      const name = `${kind}_${id}_${mode}`;
      writePng(join(OUT, 'sprites', `${name}.png`), a.width, a.height, a.data);
      writeFileSync(join(OUT, 'sprites', `${name}.json`), JSON.stringify(a.manifest, null, 2));
      index.sprites.push(name);
    }
  }
  const world: [string, Tex][] = [
    ['terrain_valley', generateTerrainAtlas()],
    ['trees_valley', generateTrees()],
    ['water_valley', generateWater()],
    ['props_valley', generateProps()],
    ['fx_common', generateEffects()],
  ];
  for (const [name, t] of world) {
    writePng(join(OUT, 'world', `${name}.png`), t.width, t.height, t.data);
    index.world.push(name);
  }
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ generatedBy: 'scripts/assets.ts export', ...index }, null, 2));
  console.log(`Exportados ${index.sprites.length} atlas de personajes y ${index.world.length} atlas de mundo en ${OUT}`);
}

function validateDirs(dirs: string[]): number {
  let errors = 0;
  let warnings = 0;
  let files = 0;
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      console.log(`(omitido: ${dir} no existe)`);
      continue;
    }
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.png'))) {
      files++;
      const name = basename(f, '.png');
      const mpath = join(dir, `${name}.json`);
      let issues: AssetIssue[];
      if (!existsSync(mpath)) {
        issues = [{ severity: 'error', message: `falta el manifiesto ${name}.json` }];
      } else {
        try {
          const png = PNG.sync.read(readFileSync(join(dir, f)));
          const manifest = JSON.parse(readFileSync(mpath, 'utf8')) as SpriteManifest;
          issues = validateAtlas(name, manifest, { width: png.width, height: png.height, rgba: new Uint8Array(png.data) });
        } catch (e) {
          issues = [{ severity: 'error', message: `no se pudo leer: ${String(e)}` }];
        }
      }
      const e = issues.filter((i) => i.severity === 'error').length;
      const w = issues.length - e;
      errors += e;
      warnings += w;
      console.log(`${e ? 'ERROR' : w ? 'AVISO' : 'OK   '} ${join(dir, f)}${issues.length ? '' : ''}`);
      for (const i of issues) console.log(`   - [${i.severity}] ${i.message}`);
    }
  }
  console.log(`\n${files} atlas validados: ${errors} errores, ${warnings} avisos`);
  return errors;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'export') exportAll();
else if (cmd === 'validate') process.exit(validateDirs(rest.length ? rest : ['assets/sprites', join(OUT, 'sprites')]) > 0 ? 1 : 0);
else {
  console.log('uso: tsx scripts/assets.ts <export|validate> [dirs...]');
  process.exit(2);
}

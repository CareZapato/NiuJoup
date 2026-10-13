// Slices the hand-painted Yamcha sheets into the hero atlas.
//   npx tsx scripts/build-yamcha-atlas.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { buildPaintedAtlas, writePreview } from './build-goku-atlas';

const DIR = resolve('assets/generated/sprites/Nuevos/Goku');

export function buildYamchaAtlas() {
  return buildPaintedAtlas({
    id: 'char:suri:hero',
    dir: DIR,
    sheets: [
      { file: 'yamcha_01.png', rows: ['idle', 'idle', 'idle', 'idle', 'jump'] },
      { file: 'yamcha_02.png', rows: ['idle_wait', 'idle_wait', 'idle_wait', 'idle_wait', 'interact'] },
      { file: 'yamcha_03.png', rows: ['walk', 'walk', 'walk', 'walk', 'dash'] },
      { file: 'yamcha_04.png', rows: ['run', 'run', 'run', 'guard', null] },
      { file: 'yamcha_05.png', rows: ['punch', 'punch', 'punch', 'dodge', 'dodge'] },
      { file: 'yamcha_06.png', rows: ['kick', 'kick', 'kick', 'pickup', 'pickup'] },
      { file: 'yamcha_07.png', rows: ['stance', 'stance', 'hover', 'hover', 'hit'] },
      { file: 'yamcha_08.png', rows: ['fly', 'fly', 'charge', 'charge', 'knockback'] },
      { file: 'yamcha_09.png', rows: ['kiblast', 'kiblast', 'confused', 'confused', 'fall'] },
      { file: 'yamcha_10.png', rows: ['victory', 'victory', 'special', 'special', 'defeat'] },
      { file: 'yamcha_11.png', rows: ['tech_wolf_fang', 'tech_wolf_fang', 'tech_wolf_fang'] },
      { file: 'yamcha_12.png', rows: ['tech_sokidan', 'tech_sokidan', 'tech_sokidan'] },
    ],
    copies: {
      tech_kamehameha: 'special',
      tech_kienzan: 'kiblast',
      tech_taiyoken: 'special',
      tech_kaioken: 'charge',
      tech_barrage: 'punch',
      tech_teleport: 'dash',
    },
  });
}

const invoked = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/build-yamcha-atlas.ts');
if (invoked) {
  const built = buildYamchaAtlas();
  if (!built) throw new Error('No se pudo construir el atlas de Yamcha');
  const outPng = resolve('assets/generated/sprites/char_suri_hero.png');
  const png = new PNG({ width: built.width, height: built.height });
  png.data = Buffer.from(built.rgba);
  mkdirSync(dirname(outPng), { recursive: true });
  writeFileSync(outPng, PNG.sync.write(png));
  writeFileSync(resolve('assets/generated/sprites/char_suri_hero.json'), JSON.stringify(built.manifest, null, 2));
  writePreview(built, 'yamcha');
  console.log(`atlas ${built.width}x${built.height} -> ${outPng}`);
}

// Slices the hand-painted Krillin sheets into the hero atlas.
//   npx tsx scripts/build-krillin-atlas.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { buildPaintedAtlas, writePreview } from './build-goku-atlas';

const DIR = resolve('assets/generated/sprites/Nuevos/Goku');

export function buildKrillinAtlas() {
  return buildPaintedAtlas({
  id: 'char:oren:hero',
  dir: DIR,
  sheets: [
    { file: 'krillin_1.png', rows: ['idle', 'idle', 'idle', 'idle', 'jump'] },
    { file: 'krillin_2.png', rows: ['idle_wait', 'idle_wait', 'idle_wait', 'idle_wait', 'interact'] },
    { file: 'krillin_3.png', rows: ['walk', 'walk', 'walk', 'walk', 'dash'] },
    { file: 'krillin_4.png', rows: ['run', 'run', 'run', 'run', 'guard'] },
    { file: 'krillin_5.png', rows: ['punch', 'punch', 'punch', 'dodge', 'dodge'] },
    { file: 'krillin_6.png', rows: ['kick', 'kick', 'kick', 'pickup', 'pickup'] },
    { file: 'krillin_7.png', rows: ['stance', 'stance', 'hover', 'hover', 'hit'] },
    { file: 'krillin_8.png', rows: ['fly', 'fly', 'charge', 'charge', 'knockback'] },
    { file: 'krillin_9.png', rows: ['kiblast', 'kiblast', 'confused', 'confused', 'fall'] },
    { file: 'krillin_10.png', rows: ['victory', 'victory', 'special', 'special', 'defeat'] },
    { file: 'krillin_11.png', rows: ['tech_kamehameha', 'tech_kamehameha', 'tech_kamehameha'] },
    { file: 'krillin_12.png', rows: ['tech_taiyoken', 'tech_taiyoken', 'tech_taiyoken'] },
    { file: 'krillin_13.png', rows: ['tech_kienzan', 'tech_kienzan', 'tech_kienzan'] },
  ],
  copies: {
    tech_sokidan: 'kiblast',
    tech_wolf_fang: 'punch',
    tech_kaioken: 'charge',
    tech_barrage: 'punch',
    tech_teleport: 'dash',
  },
  });
}

const invoked = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/build-krillin-atlas.ts');
if (invoked) {
  const built = buildKrillinAtlas();
  if (!built) throw new Error('No se pudo construir el atlas de Krillin');
const outPng = resolve('assets/generated/sprites/char_oren_hero.png');
const png = new PNG({ width: built.width, height: built.height });
png.data = Buffer.from(built.rgba);
mkdirSync(dirname(outPng), { recursive: true });
writeFileSync(outPng, PNG.sync.write(png));
writeFileSync(resolve('assets/generated/sprites/char_oren_hero.json'), JSON.stringify(built.manifest, null, 2));
writePreview(built, 'krillin');
  console.log(`atlas ${built.width}x${built.height} -> ${outPng}`);
}

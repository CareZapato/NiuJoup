// Slices the villager and enemy sheets into hero atlases.
//   npx tsx scripts/build-cast-atlas.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { buildPaintedAtlas, writePreview } from './build-goku-atlas';

const DIR = resolve('assets/generated/sprites/Nuevos/Goku');

const VILLAGER = (prefix: string): { file: string; rows: (string | null)[] }[] => [
  { file: `${prefix}_01.png`, rows: ['idle', 'idle', 'walk', 'walk', 'walk'] },
  { file: `${prefix}_02.png`, rows: ['walk', 'idle_wait', 'idle_wait', 'interact', 'interact'] },
];

const FIGHTER = (prefix: string): { file: string; rows: (string | null)[] }[] => [
  { file: `${prefix}_01.png`, rows: ['idle', 'idle', 'walk', 'walk', 'walk'] },
  { file: `${prefix}_02.png`, rows: ['walk', 'run', 'run', 'run', 'run'] },
  { file: `${prefix}_03.png`, rows: ['punch', 'punch', 'punch', 'kick', 'kick'] },
  { file: `${prefix}_04.png`, rows: ['kick', 'guard', 'hit', 'knockback', 'defeat'] },
  { file: `${prefix}_05.png`, rows: ['charge', 'charge', 'kiblast', 'kiblast', 'special'] },
  { file: `${prefix}_06.png`, rows: ['hover', 'fly', 'dash', 'victory', 'victory'] },
];

const VILLAGER_COPIES = {
  jump: 'idle',
  pickup: 'interact',
  stance: 'idle',
  hover: 'idle',
  fly: 'idle',
  run: 'walk',
  punch: 'idle',
  kick: 'idle',
  guard: 'idle',
  dodge: 'walk',
  dash: 'walk',
  charge: 'idle',
  kiblast: 'interact',
  hit: 'idle',
  confused: 'idle',
  knockback: 'idle',
  fall: 'idle',
  defeat: 'idle',
  victory: 'idle_wait',
  special: 'interact',
  tech_kamehameha: 'interact',
  tech_kienzan: 'interact',
  tech_taiyoken: 'interact',
  tech_sokidan: 'interact',
  tech_wolf_fang: 'idle',
  tech_kaioken: 'idle',
  tech_barrage: 'idle',
  tech_teleport: 'walk',
};

const FIGHTER_COPIES = {
  idle_wait: 'idle',
  jump: 'dash',
  pickup: 'idle',
  interact: 'idle',
  stance: 'guard',
  dodge: 'dash',
  confused: 'hit',
  fall: 'knockback',
  tech_kamehameha: 'special',
  tech_kienzan: 'kiblast',
  tech_taiyoken: 'special',
  tech_sokidan: 'kiblast',
  tech_wolf_fang: 'punch',
  tech_kaioken: 'charge',
  tech_barrage: 'punch',
  tech_teleport: 'dash',
};

const CAST: { id: string; file: string; preview: string; sheets: { file: string; rows: (string | null)[] }[]; copies: Record<string, string> }[] = [
  { id: 'npc:master', file: 'npc_master_hero', preview: 'hoku', sheets: VILLAGER('npc_hoku'), copies: VILLAGER_COPIES },
  { id: 'npc:villager', file: 'npc_villager_hero', preview: 'mira', sheets: VILLAGER('npc_mira'), copies: VILLAGER_COPIES },
  { id: 'npc:smith', file: 'npc_smith_hero', preview: 'bram', sheets: VILLAGER('npc_bram'), copies: VILLAGER_COPIES },
  { id: 'enemy:sprout', file: 'enemy_sprout_hero', preview: 'sprout', sheets: FIGHTER('enemy_sprout'), copies: FIGHTER_COPIES },
  { id: 'enemy:bandit', file: 'enemy_bandit_hero', preview: 'bandit', sheets: FIGHTER('enemy_bandit'), copies: FIGHTER_COPIES },
  { id: 'enemy:golem', file: 'enemy_golem_hero', preview: 'dino', sheets: FIGHTER('enemy_dino'), copies: FIGHTER_COPIES },
];

function writeOne(entry: (typeof CAST)[number]): void {
  const built = buildPaintedAtlas({ id: `${entry.id}:hero`, dir: DIR, sheets: entry.sheets, copies: entry.copies });
  if (!built) throw new Error(`No se pudo construir ${entry.file}`);
  const outPng = resolve(`assets/generated/sprites/${entry.file}.png`);
  const png = new PNG({ width: built.width, height: built.height });
  png.data = Buffer.from(built.rgba);
  mkdirSync(dirname(outPng), { recursive: true });
  writeFileSync(outPng, PNG.sync.write(png));
  writeFileSync(resolve(`assets/generated/sprites/${entry.file}.json`), JSON.stringify(built.manifest, null, 2));
  writePreview(built, entry.preview);
  console.log(`atlas ${built.width}x${built.height} -> ${outPng}`);
}

const invoked = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/build-cast-atlas.ts');
if (invoked) for (const entry of CAST) writeOne(entry);

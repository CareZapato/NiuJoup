import { BALANCE } from '../../content/balance';
import type { FarmLedger, PartyMember } from '../progression/progression';
import type { QuestProgress } from '../progression/quests';

export const CURRENT_SAVE_VERSION = BALANCE.save.schemaVersion;

export interface WorldPersistence {
  openedChests: string[];
  collectedPickups: string[];
  brokenObstacles: string[];
  defeatedPersistent: string[];
  /** stableId -> gameTime (seconds) at which the enemy respawns. */
  enemyRespawnAt: Record<string, number>;
  visitedAreas: string[];
}

export interface SaveDataV2 {
  version: 2;
  savedAt: number;
  playTimeSeconds: number;
  gameTime: number;
  mapId: string;
  leader: string;
  partyOrder: string[];
  roster: Record<string, PartyMember>;
  position: { x: number; y: number; z: number };
  checkpoint: { mapId: string; x: number; z: number };
  inventory: Record<string, number>;
  money: number;
  world: WorldPersistence;
  quests: Record<string, QuestProgress>;
  farm: FarmLedger;
}

export type SaveData = SaveDataV2;

/** Legacy shape kept to demonstrate and test the migration path. */
export interface SaveDataV1 {
  version: 1;
  savedAt: number;
  party: { id: string; level: number; xp: number; ap: number; skills: string[] }[];
  gold: number;
  items: Record<string, number>;
  position: { x: number; z: number };
  flags: string[];
}

type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Record<number, Migration> = {
  1: (raw) => {
    const v1 = raw as unknown as SaveDataV1;
    const roster: Record<string, PartyMember> = {};
    for (const p of v1.party) {
      roster[p.id] = {
        characterId: p.id,
        level: p.level,
        xp: p.xp,
        ap: p.ap,
        skills: Object.fromEntries(p.skills.map((s) => [s, 1])),
        equipment: { hands: null, body: null, accessory: null },
        hp: 1e9,
        ki: 1e9,
      };
    }
    const v2: SaveDataV2 = {
      version: 2,
      savedAt: v1.savedAt,
      playTimeSeconds: 0,
      gameTime: 0,
      mapId: 'valley',
      leader: v1.party[0]?.id ?? 'kaien',
      partyOrder: v1.party.slice(0, 3).map((p) => p.id),
      roster,
      position: { x: v1.position.x, y: 0, z: v1.position.z },
      checkpoint: { mapId: 'valley', x: v1.position.x, z: v1.position.z },
      inventory: { ...v1.items },
      money: v1.gold,
      world: {
        openedChests: v1.flags.filter((f) => f.startsWith('chest:')).map((f) => f.slice(6)),
        collectedPickups: [],
        brokenObstacles: [],
        defeatedPersistent: v1.flags.filter((f) => f.startsWith('boss:')).map((f) => f.slice(5)),
        enemyRespawnAt: {},
        visitedAreas: [],
      },
      quests: {},
      farm: { kills: [] },
    };
    return v2 as unknown as Record<string, unknown>;
  },
};

export function migrate(raw: Record<string, unknown>): SaveData {
  let data = raw;
  let version = typeof data.version === 'number' ? data.version : 0;
  if (version > CURRENT_SAVE_VERSION) throw new Error(`Save version ${version} is newer than supported ${CURRENT_SAVE_VERSION}`);
  while (version < CURRENT_SAVE_VERSION) {
    const m = MIGRATIONS[version];
    if (!m) throw new Error(`No migration from version ${version}`);
    data = m(data);
    version = data.version as number;
  }
  return validate(data);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function validate(d: Record<string, unknown>): SaveData {
  const fail = (what: string): never => {
    throw new Error(`Invalid save: ${what}`);
  };
  if (d.version !== 2) fail('version');
  if (!isNum(d.savedAt) || !isNum(d.playTimeSeconds) || !isNum(d.gameTime) || !isNum(d.money)) fail('numbers');
  if (typeof d.mapId !== 'string' || typeof d.leader !== 'string') fail('ids');
  if (!isStrArr(d.partyOrder) || (d.partyOrder as string[]).length === 0) fail('partyOrder');
  if (!isObj(d.roster)) fail('roster');
  for (const id of d.partyOrder as string[]) {
    const m = (d.roster as Record<string, unknown>)[id];
    if (!isObj(m) || !isNum(m.level) || !isNum(m.xp) || !isNum(m.ap) || !isObj(m.skills) || !isObj(m.equipment)) fail(`member ${id}`);
  }
  const pos = d.position as Record<string, unknown>;
  if (!isObj(pos) || !isNum(pos.x) || !isNum(pos.z)) fail('position');
  if (!isObj(d.inventory) || !isObj(d.world) || !isObj(d.quests) || !isObj(d.farm)) fail('sections');
  const w = d.world as Record<string, unknown>;
  for (const k of ['openedChests', 'collectedPickups', 'brokenObstacles', 'defeatedPersistent', 'visitedAreas']) if (!isStrArr(w[k])) fail(`world.${k}`);
  return d as unknown as SaveData;
}

/** FNV-1a 32-bit checksum to detect truncated/corrupted payloads. */
export function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

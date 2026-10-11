import { BALANCE, xpToNextLevel } from '../../content/balance';
import { CHARACTERS } from '../../content/characters';
import { ITEMS } from '../../content/items';
import { SKILLS, SKILL_TREES } from '../../content/skills';
import type { EquipSlot, StatKey, Stats } from '../../content/types';

export interface PartyMember {
  characterId: string;
  level: number;
  xp: number;
  ap: number;
  skills: Record<string, number>;
  equipment: Record<EquipSlot, string | null>;
  hp: number;
  ki: number;
}

export function createMember(characterId: string): PartyMember {
  const m: PartyMember = {
    characterId,
    level: 1,
    xp: 0,
    ap: 0,
    skills: {},
    equipment: { hands: null, body: null, accessory: null },
    hp: 0,
    ki: 0,
  };
  const s = computeStats(m);
  m.hp = s.maxHp;
  m.ki = s.maxKi;
  return m;
}

export function computeStats(m: PartyMember): Stats {
  const def = CHARACTERS[m.characterId];
  if (!def) throw new Error(`Unknown character ${m.characterId}`);
  const s: Stats = { ...def.baseStats };
  const lv = m.level - 1;
  for (const k of Object.keys(def.growth) as StatKey[]) s[k] += (def.growth[k] ?? 0) * lv;
  for (const [skillId, level] of Object.entries(m.skills)) {
    const sk = SKILLS[skillId];
    if (!sk) continue;
    for (const k of Object.keys(sk.statBonusPerLevel) as StatKey[]) s[k] += (sk.statBonusPerLevel[k] ?? 0) * level;
  }
  for (const itemId of Object.values(m.equipment)) {
    if (!itemId) continue;
    const eq = ITEMS[itemId]?.equip;
    if (!eq) continue;
    for (const k of Object.keys(eq.stats) as StatKey[]) s[k] += eq.stats[k] ?? 0;
  }
  s.maxHp = Math.round(s.maxHp);
  s.maxKi = Math.round(s.maxKi);
  return s;
}

export function unlockedMoves(m: PartyMember): string[] {
  const def = CHARACTERS[m.characterId];
  const moves = new Set(def.innateMoves);
  for (const [skillId, level] of Object.entries(m.skills)) {
    if (level <= 0) continue;
    for (const mv of SKILLS[skillId]?.unlocksMoves ?? []) moves.add(mv);
  }
  return [...moves];
}

export function passivesOf(m: PartyMember): string[] {
  const p = new Set<string>();
  for (const [skillId, level] of Object.entries(m.skills)) {
    if (level <= 0) continue;
    for (const x of SKILLS[skillId]?.passives ?? []) p.add(x);
  }
  return [...p];
}

export interface LevelUpResult {
  levelsGained: number;
  newLevel: number;
}

export function grantXp(m: PartyMember, amount: number): LevelUpResult {
  const before = m.level;
  m.xp += Math.max(0, Math.floor(amount));
  while (m.level < BALANCE.progression.maxLevel && m.xp >= xpToNextLevel(m.level)) {
    m.xp -= xpToNextLevel(m.level);
    m.level++;
    m.ap += BALANCE.progression.apPerLevelUp;
  }
  const gained = m.level - before;
  if (gained > 0) {
    const s = computeStats(m);
    m.hp = s.maxHp;
    m.ki = s.maxKi;
  }
  return { levelsGained: gained, newLevel: m.level };
}

export type PurchaseCheck = { ok: true; cost: number } | { ok: false; reason: string };

export function canPurchaseSkill(m: PartyMember, skillId: string): PurchaseCheck {
  const sk = SKILLS[skillId];
  if (!sk) return { ok: false, reason: 'Habilidad desconocida' };
  const tree = SKILL_TREES[CHARACTERS[m.characterId].skillTree];
  if (!tree.nodes.some((n) => n.skillId === skillId)) return { ok: false, reason: 'No disponible para este personaje' };
  const current = m.skills[skillId] ?? 0;
  if (current >= sk.maxLevel) return { ok: false, reason: 'Nivel máximo' };
  if (m.level < sk.minCharacterLevel) return { ok: false, reason: `Requiere nivel ${sk.minCharacterLevel}` };
  for (const pre of sk.prerequisites) {
    if ((m.skills[pre.skillId] ?? 0) < pre.level) return { ok: false, reason: `Requiere ${SKILLS[pre.skillId]?.name ?? pre.skillId}` };
  }
  const cost = sk.costPerLevel[current] ?? sk.costPerLevel[sk.costPerLevel.length - 1];
  if (m.ap < cost) return { ok: false, reason: `Faltan AP (${cost})` };
  return { ok: true, cost };
}

export function purchaseSkill(m: PartyMember, skillId: string): PurchaseCheck {
  const check = canPurchaseSkill(m, skillId);
  if (!check.ok) return check;
  m.ap -= check.cost;
  m.skills[skillId] = (m.skills[skillId] ?? 0) + 1;
  return check;
}

/** Tracks recent kills per enemy type in game-time seconds to dampen farming. */
export interface FarmLedger {
  kills: { enemyId: string; time: number }[];
}

export function farmMultiplier(ledger: FarmLedger, enemyId: string, now: number): number {
  const p = BALANCE.progression;
  const recent = ledger.kills.filter((k) => k.enemyId === enemyId && now - k.time < p.farmWindowSeconds).length;
  const over = Math.max(0, recent - p.farmFreeKills);
  return Math.max(p.farmMinMultiplier, 1 - over * p.farmPenaltyPerKill);
}

export function levelGapMultiplier(partyLevel: number, enemyLevel: number): number {
  const p = BALANCE.progression;
  const gap = partyLevel - enemyLevel - p.levelGapSoftCap;
  if (gap <= 0) return 1;
  return Math.max(p.farmMinMultiplier, 1 - gap * p.levelGapPenaltyPerLevel);
}

export function recordKill(ledger: FarmLedger, enemyId: string, now: number): void {
  ledger.kills.push({ enemyId, time: now });
  const cutoff = now - BALANCE.progression.farmWindowSeconds;
  ledger.kills = ledger.kills.filter((k) => k.time >= cutoff);
}

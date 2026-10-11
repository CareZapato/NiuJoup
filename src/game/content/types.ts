export type Team = 'player' | 'enemy';

export interface Stats {
  maxHp: number;
  maxKi: number;
  physicalAttack: number;
  kiAttack: number;
  physicalDefense: number;
  kiDefense: number;
  speed: number;
  technique: number;
  criticalRate: number;
  evasion: number;
  stamina: number;
}

export type StatKey = keyof Stats;

/** Numpad notation relative to the current target: 6 = toward, 4 = away, 8/2 = lateral, 5 = neutral. */
export type NumpadDir = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type ButtonId = 'light' | 'heavy' | 'ki' | 'guard' | 'charge' | 'dash' | 'up' | 'down' | 'special';

export interface CommandPattern {
  /** Directions that must appear in order before the button (lenient: other dirs may appear in between if `strict` is false). */
  sequence?: NumpadDir[];
  /** Buttons pressed on the final step (more than one = simultaneous press). */
  buttons: ButtonId[];
  /** Buttons that must be held while pressing. */
  held?: ButtonId[];
  /** Any of these directions must be held at press time. */
  holdDir?: NumpadDir[];
  /** Hold the button for N ticks and release (charge-type commands). */
  chargeTicks?: number;
  priority: number;
  label: string;
}

export interface Hitbox {
  forward: number;
  up: number;
  radius: number;
}

export type MoveKind = 'light' | 'heavy' | 'ki' | 'special' | 'rush' | 'launcher';

export interface ProjectileDef {
  speed: number;
  radius: number;
  lifetimeTicks: number;
  pierce: boolean;
  homing: number;
  /** Breaks world obstacles flagged as `kiBreakable`. */
  breaksObstacles: boolean;
  visual: 'ki_ball' | 'ki_wave' | 'ki_charged';
}

export interface MoveDef {
  id: string;
  name: string;
  kind: MoveKind;
  damage: number;
  /** Which attack stat scales the damage. */
  damageType: 'physical' | 'ki';
  kiCost: number;
  startup: number;
  active: number;
  recovery: number;
  hitbox: Hitbox;
  knockback: number;
  lift: number;
  hitstun: number;
  /** Forward impulse (units/s) applied during startup+active. */
  lunge: number;
  /** Moves this one can cancel into, and from which tick (relative to move start). */
  cancelInto: string[];
  cancelFrom: number;
  /** Chains only allowed if this move connected (hit or blocked). */
  cancelOnHitOnly: boolean;
  comboScaling: number;
  /** Ends a combo string; awards the combo bonus to Power Balance. */
  finisher: boolean;
  causes: 'hitstun' | 'knockback' | 'launch';
  projectile?: ProjectileDef;
  cooldownTicks: number;
  powerBalance: number;
  vfx: string;
  sfx: string;
  command: CommandPattern | null;
  /** Skill id that unlocks this move, or null if innate. */
  unlockedBy: string | null;
  description: string;
}

export type AiStyle = 'balanced' | 'rushdown' | 'zoner' | 'tank' | 'brute';

export interface Palette {
  skin: number;
  hair: number;
  outfit: number;
  outfitDark: number;
  accent: number;
  boots: number;
  aura: number;
}

export interface AppearanceDef {
  palette: Palette;
  hairStyle: 'spiky' | 'ponytail' | 'bald' | 'mohawk' | 'leaf' | 'bandana' | 'stone';
  build: 'normal' | 'slim' | 'broad' | 'huge';
  scale: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  archetype: 'Guerrero equilibrado' | 'Luchador ágil' | 'Especialista en Ki' | 'Luchador defensivo';
  description: string;
  baseStats: Stats;
  growth: Partial<Record<StatKey, number>>;
  appearance: AppearanceDef;
  innateMoves: string[];
  skillTree: string;
  aiStyle: AiStyle;
  meteoMoveId: string;
  jointPartners: string[];
  transformations: string[];
}

export interface EnemyDef {
  id: string;
  name: string;
  level: number;
  baseStats: Stats;
  appearance: AppearanceDef;
  moves: string[];
  aiStyle: AiStyle;
  xp: number;
  ap: number;
  money: number;
  lootTable: string;
  detectRadius: number;
  /** Mini-bosses and story enemies stay defeated permanently. */
  persistentDefeat: boolean;
  respawnSeconds: number;
}

export type SkillCategory = 'physical' | 'ki' | 'movement' | 'defense' | 'passive' | 'transformation' | 'joint';

export interface SkillDef {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  maxLevel: number;
  costPerLevel: number[];
  prerequisites: { skillId: string; level: number }[];
  minCharacterLevel: number;
  unlocksMoves: string[];
  statBonusPerLevel: Partial<Record<StatKey, number>>;
  passives: string[];
  /** Displayed command hint. */
  command?: string;
  evolvesTo?: string;
}

export interface SkillTreeDef {
  id: string;
  nodes: { skillId: string; col: number; row: number }[];
}

export type ItemType = 'consumable' | 'equipment' | 'material' | 'key' | 'quest' | 'rare';
export type EquipSlot = 'hands' | 'body' | 'accessory';

export interface ItemDef {
  id: string;
  name: string;
  type: ItemType;
  description: string;
  stackable: boolean;
  important: boolean;
  heal?: { hp?: number; ki?: number };
  equip?: { slot: EquipSlot; stats: Partial<Record<StatKey, number>> };
  value: number;
}

export interface LootTableDef {
  id: string;
  rolls: number;
  entries: { itemId: string; weight: number; min: number; max: number }[];
  /** Chance that a roll produces nothing. */
  emptyWeight: number;
}

export type QuestType = 'story' | 'side' | 'training' | 'exploration' | 'challenge';

export type QuestObjective =
  | { kind: 'talk'; npcId: string; text: string }
  | { kind: 'visit'; areaId: string; text: string }
  | { kind: 'collect'; itemId: string; count: number; text: string }
  | { kind: 'defeat'; enemyId: string | 'any'; count: number; text: string }
  | { kind: 'earnAp'; amount: number; text: string }
  | { kind: 'unlockSkill'; text: string }
  | { kind: 'defeatBoss'; enemyId: string; text: string };

export interface QuestDef {
  id: string;
  name: string;
  type: QuestType;
  description: string;
  giverNpcId: string;
  objectives: QuestObjective[];
  rewards: { xp: number; ap: number; money: number; items: { itemId: string; count: number }[] };
}

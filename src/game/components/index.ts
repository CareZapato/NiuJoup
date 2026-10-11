import type { Vec3 } from '../core/math';
import type { AiStyle, AppearanceDef, ButtonId, Stats, Team } from '../content/types';

export type EntityKind = 'hero' | 'enemy' | 'npc' | 'chest' | 'pickup' | 'projectile' | 'recovery' | 'boulder';

export interface Transform {
  pos: Vec3;
  /** Previous tick position, for render interpolation. */
  prev: Vec3;
  /** World-space facing yaw (0 = +Z). Independent from the sprite's visual direction. */
  yaw: number;
}

export interface Body {
  vel: Vec3;
  radius: number;
  height: number;
  grounded: boolean;
  /** Flying bodies ignore gravity and liquids (combat flight). */
  flying: boolean;
}

export type AnimId =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'interact'
  | 'hover'
  | 'fly'
  | 'punch'
  | 'kick'
  | 'guard'
  | 'hit'
  | 'knockback'
  | 'dash'
  | 'charge'
  | 'kiblast'
  | 'special'
  | 'defeat'
  | 'victory';

export interface SpriteComp {
  atlas: string;
  anim: AnimId;
  animTicks: number;
  /** Visual-only flags. */
  flashTicks: number;
  visible: boolean;
  alpha: number;
  scale: number;
  aura: boolean;
  transformed: boolean;
}

export type CombatStateId =
  | 'IDLE'
  | 'MOVE'
  | 'FLY'
  | 'DASH'
  | 'LIGHT_ATTACK'
  | 'HEAVY_ATTACK'
  | 'KI_ATTACK'
  | 'CHARGE'
  | 'GUARD'
  | 'PARRY'
  | 'HIT_STUN'
  | 'KNOCKBACK'
  | 'LAUNCHED'
  | 'RECOVERY'
  | 'SPECIAL_ATTACK'
  | 'DEFEATED';

export type AllyOrder = 'AGGRESSIVE' | 'BALANCED' | 'DEFENSIVE' | 'SUPPORT' | 'FOCUS_TARGET';

/** What a controller (player input or AI) wants this tick. Both feed the same combat code. */
export interface Intent {
  moveX: number;
  moveZ: number;
  moveY: number;
  /** Move id requested this tick (already resolved from commands), or null. */
  action: string | null;
  dash: boolean;
  guard: boolean;
  charge: boolean;
  special: boolean;
  nextTarget: boolean;
  teleport: boolean;
}

export const emptyIntent = (): Intent => ({
  moveX: 0,
  moveZ: 0,
  moveY: 0,
  action: null,
  dash: false,
  guard: false,
  charge: false,
  special: false,
  nextTarget: false,
  teleport: false,
});

export function clearIntent(i: Intent): void {
  i.moveX = 0;
  i.moveZ = 0;
  i.moveY = 0;
  i.action = null;
  i.dash = false;
  i.guard = false;
  i.charge = false;
  i.special = false;
  i.nextTarget = false;
  i.teleport = false;
}

export type AiAction = 'approach' | 'attack' | 'kiBlast' | 'charge' | 'guard' | 'evade' | 'retreat' | 'circle' | 'support' | 'special' | 'chase';

export interface AiBrain {
  style: AiStyle;
  order: AllyOrder;
  action: AiAction;
  actionTicks: number;
  decisionCooldown: number;
  /** Last utility scores, exposed to the debug overlay. */
  scores: Partial<Record<AiAction, number>>;
  comboStep: number;
  reactionTicks: number;
  circleSign: number;
  /** Difficulty: 0..1, affects reaction time and guard probability. */
  skill: number;
}

export interface MeteoState {
  targetId: number;
  partnerId: number;
  tick: number;
  damageDealt: boolean;
  defended: boolean;
}

export interface Combatant {
  team: Team;
  name: string;
  level: number;
  /** In the current encounter. Combatants outside an encounter don't fight. */
  engaged: boolean;
  stats: Stats;
  hp: number;
  ki: number;
  state: CombatStateId;
  stateTicks: number;
  moveId: string | null;
  moveTick: number;
  /** Entity ids already hit by the current move (each target is hit once per move). */
  moveHits: number[];
  moveConnected: boolean;
  bufferedAction: string | null;
  bufferedTicks: number;
  hitstun: number;
  invuln: number;
  targetId: number;
  comboCount: number;
  comboTimer: number;
  comboDamage: number;
  lastHitBy: number;
  lastHitTick: number;
  guardStartTick: number;
  dashTicks: number;
  dashDir: Vec3;
  chargeHeld: number;
  cooldowns: Record<string, number>;
  unlockedMoves: string[];
  passives: string[];
  playerControlled: boolean;
  meteoMoveId: string;
  meteo: MeteoState | null;
  /** True while receiving a meteo attack (cannot act). */
  meteoVictim: boolean;
  jointPartners: string[];
  ai: AiBrain;
  intent: Intent;
  /** Last entity this combatant launched, enabling Air Chase. */
  lastLaunchedTarget: number;
  lastLaunchTick: number;
  /** Freeze frames on impact for both attacker and defender. */
  hitstop: number;
  transformed: boolean;
}

export interface HeroComp {
  characterId: string;
  partyIndex: number;
}

export type ExplorerState = 'IDLE' | 'PATROL' | 'ALERT' | 'CHASE' | 'RETURN' | 'IN_COMBAT' | 'DEFEATED';

export interface ExplorerAI {
  enemyId: string;
  groupId: string;
  home: Vec3;
  patrolRadius: number;
  state: ExplorerState;
  stateTicks: number;
  wanderTarget: Vec3;
  detectRadius: number;
  alertTicks: number;
}

export interface Interactable {
  kind: 'npc' | 'chest' | 'pickup' | 'recovery' | 'boulder';
  refId: string;
  radius: number;
  used: boolean;
  prompt: string;
}

export interface ProjectileComp {
  ownerId: number;
  team: Team;
  moveId: string;
  vel: Vec3;
  ticksLeft: number;
  radius: number;
  pierce: boolean;
  homing: number;
  targetId: number;
  hits: number[];
  visual: string;
  breaksObstacles: boolean;
  power: number;
}

export interface NpcComp {
  appearance: string;
  name: string;
}

export interface Entity {
  id: number;
  stableId: string;
  kind: EntityKind;
  transform: Transform;
  body?: Body;
  sprite?: SpriteComp;
  appearance?: AppearanceDef;
  hero?: HeroComp;
  combatant?: Combatant;
  explorer?: ExplorerAI;
  interactable?: Interactable;
  projectile?: ProjectileComp;
  npc?: NpcComp;
}

export type ComponentKey = Exclude<keyof Entity, 'id' | 'stableId' | 'kind' | 'transform'>;

export type ButtonState = Record<ButtonId, boolean>;

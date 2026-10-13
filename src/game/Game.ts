import { type AiBrain, type Combatant, clearIntent, emptyIntent, type Entity } from './components';
import { BALANCE, xpToNextLevel } from './content/balance';
import { CHARACTERS, ENEMIES, NPC_APPEARANCES, STARTING_PARTY } from './content/characters';
import { ITEMS, QUESTS } from './content/items';
import { buildValley, type MapDef } from './content/maps/valley';
import { getMove, MOVES, NAME_STATUS_LABEL, sequencesOf } from './content/moves';
import type { AiStyle, AppearanceDef, ButtonId, EquipSlot, FocusSymbol, Stats, Team } from './content/types';
import { World } from './core/ecs/World';
import { EventBus } from './core/events/EventBus';
import { FixedLoop, TICK_DT } from './core/loop/FixedLoop';
import { clamp, damp, distXZ, lerpAngle, Rng, vec3, type Vec3, wrapAngle } from './core/math';
import { type GameState, GameStateMachine } from './core/state/GameStateMachine';
import type { GameEvents } from './events';
import { interpretCommand, scaledConfig } from './input/CommandInterpreter';
import { BUTTON_BITS, InputBuffer, relativeDir } from './input/InputBuffer';
import { InputReader, RawInput } from './input/RawInput';
import { DEFAULT_SETTINGS, type BindAction, type Settings, SLOT_ACTIONS } from './settings';
import { CombatAI } from './systems/ai/CombatAI';
import { ExplorerAI } from './systems/ai/ExplorerAI';
import { POSE_ANIM, updateAnimations } from './systems/animation/AnimationSystem';
import { createWind, stepWind, type WindState } from './systems/world/Wind';
import { CameraRig, type CameraPose, makePose, screenToWorld, worldToScreen, yawForScreenRight } from './systems/camera/CameraRig';
import { type Arena, canAct, type CombatContext, CombatSystem, techniqueBlocker } from './systems/combat/CombatSystem';
import { chargeKi, penalizeKi, regenKi, spendKi } from './systems/combat/ki';
import { PowerBalance } from './systems/combat/PowerBalance';
import { createProjectile, ProjectileSystem } from './systems/combat/ProjectileSystem';
import { limitReady, rageFromDominance } from './systems/combat/rage';
import { clipLine, cycleTarget, isAlive, isWorldHostile } from './systems/combat/targeting';
import { type FocusCandidate, FocusController, type FocusOutcome } from './systems/focus/FocusController';
import { followTrail, moveGroundBody, PartyTrail, tryJump } from './systems/movement/ExplorationMovement';
import type { SaveData, WorldPersistence } from './systems/persistence/saveSchema';
import type { SaveManager } from './systems/persistence/SaveManager';
import { EquipmentManager, InventoryManager, LootTableManager } from './systems/progression/inventory';
import {
  assignSlot,
  computeStats,
  createMember,
  type FarmLedger,
  farmMultiplier,
  grantXp,
  levelGapMultiplier,
  masteryOf,
  normalizeSlots,
  passivesOf,
  type PartyMember,
  purchaseSkill,
  recordKill,
  unlockedMoves,
  unlockedTechniques,
} from './systems/progression/progression';
import { QuestManager, type QuestUpdate } from './systems/progression/quests';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'warn' | 'quest';
  until: number;
}

export interface RewardSummary {
  xp: number;
  ap: number;
  money: number;
  items: { itemId: string; name: string; count: number }[];
  levelUps: { name: string; level: number }[];
  farmPenalty: boolean;
}

export interface UiCombatant {
  id: number;
  name: string;
  team: Team;
  hp: number;
  maxHp: number;
  ki: number;
  maxKi: number;
  state: string;
  isTarget: boolean;
  controlled: boolean;
  color: number;
  transformed: boolean;
  rage: number;
}

export interface UiSlot {
  index: number;
  moveId: string | null;
  name: string;
  kiCost: number;
  cooldown: number;
  cooldownMax: number;
  affordable: boolean;
  /** Not usable in the current context (world vs combat) or blocked. */
  usable: boolean;
  blocked: string | null;
  sequence: FocusSymbol[] | null;
  direct: boolean;
}

export interface UiFocus {
  active: boolean;
  /** Real seconds left in the window. */
  remaining: number;
  window: number;
  input: FocusSymbol[];
  candidates: { moveId: string; name: string; sequence: FocusSymbol[]; mode: 'spread' | 'concentrate'; limit: boolean; matching: boolean }[];
  /** Simulation seconds until focus can be used again. */
  cooldown: number;
  ready: boolean;
}

export interface UiSnapshot {
  version: number;
  state: GameState;
  previousState: GameState;
  cameraMode: string;
  party: { characterId: string; name: string; level: number; hp: number; maxHp: number; ki: number; maxKi: number; xp: number; xpNext: number; ap: number; isLeader: boolean; rage: number }[];
  slots: UiSlot[];
  limit: { moveId: string; name: string; rage: number; ready: boolean; sequence: FocusSymbol[] } | null;
  focus: UiFocus;
  /** Status of the controlled fighter. */
  status: { confused: number; charging: boolean; kaioken: number; blinded: number };
  combatants: UiCombatant[];
  pb: { value: number; dominance: Team | null; ticksLeft: number; threshold: number };
  combo: number;
  comboDamage: number;
  prompt: string | null;
  objective: string | null;
  money: number;
  area: string | null;
  toasts: Toast[];
  dialogue: { speaker: string; line: string; index: number; total: number } | null;
  rewards: RewardSummary | null;
  save: { status: 'idle' | 'saving' | 'saved' | 'error'; text: string };
  minimap: { w: number; h: number; player: { x: number; z: number; yaw: number }; enemies: { x: number; z: number; boss: boolean }[]; points: { x: number; z: number; kind: string }[] };
  controlledMoves: { id: string; name: string; cooldown: number; kiCost: number; affordable: boolean }[];
  specialReady: boolean;
  debug: { fps: number; tick: number; entities: number; lines: string[] } | null;
  playTime: number;
}

interface Encounter {
  groupId: string;
  heroIds: number[];
  enemyIds: number[];
  arena: Arena;
  formation: Map<number, Vec3>;
}

const BUTTONS: ButtonId[] = ['light', 'heavy', 'ki', 'guard', 'charge', 'dash', 'up', 'down', 'special'];
const SIM_ACTIONS: BindAction[] = [...BUTTONS, 'focus', ...SLOT_ACTIONS, 'camLeft', 'camRight', 'nextAlly', 'nextTarget', 'menu', 'debug'];
/** Buttons that act as focus symbols (directions come from the stick). */
const FOCUS_BUTTONS: [BindAction, FocusSymbol][] = [
  ['light', 'P'],
  ['ki', 'K'],
  ['heavy', 'H'],
  ['guard', 'G'],
];
const FOCUS_DIRS: [BindAction, number, number][] = [
  ['stickUp', 0, 1],
  ['stickDown', 0, -1],
  ['stickLeft', -1, 0],
  ['stickRight', 1, 0],
];
const F = BALANCE.focus;

function makeBrain(style: AiStyle, skill: number): AiBrain {
  return { style, order: 'BALANCED', action: 'approach', actionTicks: 0, decisionCooldown: 0, scores: {}, comboStep: 0, reactionTicks: 0, circleSign: 1, skill, techniqueCooldown: 0 };
}

function makeCombatant(team: Team, name: string, level: number, stats: Stats, moves: string[], passives: string[], style: AiStyle, meteo: string, joint: string[], skill: number): Combatant {
  return {
    team,
    name,
    level,
    engaged: false,
    stats,
    hp: stats.maxHp,
    ki: stats.maxKi,
    state: 'IDLE',
    stateTicks: 0,
    moveId: null,
    moveTick: 0,
    moveHits: [],
    moveConnected: false,
    bufferedAction: null,
    bufferedTicks: 0,
    hitstun: 0,
    invuln: 0,
    targetId: -1,
    comboCount: 0,
    comboTimer: 0,
    comboDamage: 0,
    lastHitBy: -1,
    lastHitTick: -999,
    guardStartTick: -999,
    dashTicks: 0,
    dashDir: vec3(),
    chargeHeld: 0,
    cooldowns: {},
    unlockedMoves: moves,
    passives,
    playerControlled: false,
    meteoMoveId: meteo,
    meteo: null,
    meteoVictim: false,
    jointPartners: joint,
    ai: makeBrain(style, skill),
    intent: emptyIntent(),
    lastLaunchedTarget: -1,
    lastLaunchTick: -999,
    hitstop: 0,
    transformed: false,
    rage: 0,
    confusedTicks: 0,
    blindTicks: 0,
    stunChain: 0,
    stunArmorTicks: 0,
    buff: null,
    sequenceToken: null,
    castMode: 'spread',
    castId: 0,
    castEmitted: 0,
    castHits: {},
    mastery: {},
    slots: [null, null, null, null],
  };
}

function heroCombatant(id: string, m: PartyMember, order: AiBrain['order']): Combatant {
  const def = CHARACTERS[id];
  const moves = unlockedMoves(m);
  if (m.limit) moves.push(m.limit);
  const c = makeCombatant('player', def.name, m.level, computeStats(m), moves, passivesOf(m), def.aiStyle, def.meteoMoveId, def.jointPartners, 0.8);
  c.hp = m.hp;
  c.ki = m.ki;
  c.rage = m.rage;
  c.slots = [...m.slots];
  c.mastery = masteryOf(m);
  c.ai.order = order;
  return c;
}

/**
 * Game core orchestrator. Owns the ECS world, systems and state machine and
 * runs at a fixed 60 Hz independent of React or the renderer.
 */
export class Game {
  readonly events = new EventBus<GameEvents>();
  readonly world = new World();
  readonly fsm = new GameStateMachine();
  readonly loop: FixedLoop;
  readonly camera = new CameraRig();
  readonly pb = new PowerBalance();
  readonly input = new RawInput();
  readonly buffer = new InputBuffer();
  rng = new Rng(20261011);
  map: MapDef = buildValley();
  settings: Settings = { ...DEFAULT_SETTINGS, bindings: { ...DEFAULT_SETTINGS.bindings } };
  /** Valley wind. Trees lean with it. */
  readonly wind: WindState = createWind();

  roster: Record<string, PartyMember> = {};
  partyOrder: string[] = [];
  leaderId = 'kaien';
  inventory = new InventoryManager();
  quests = new QuestManager();
  money = 0;
  worldState: WorldPersistence = emptyWorld();
  farm: FarmLedger = { kills: [] };
  gameTime = 0;
  playTime = 0;
  checkpoint = { mapId: 'valley', x: 0, z: 0 };
  allyOrders: Record<string, AiBrain['order']> = {};

  encounter: Encounter | null = null;
  controlledId = -1;
  saveManager: SaveManager | null = null;
  fps = 0;

  private combat = new CombatSystem();
  private combatAI = new CombatAI();
  private explorerAI = new ExplorerAI();
  private projectiles: ProjectileSystem;
  private trail = new PartyTrail();
  /** 60 Hz simulation reader. */
  private sim: InputReader;
  /** Real-time reader used only while focusing. */
  private focusReader: InputReader;
  readonly focus = new FocusController();
  /** Simulation tick from which focus can be used again. */
  focusReadyTick = 0;
  /** Current simulation time scale (1, or the focus slow motion). Never stacked. */
  timeScale = 1;
  /** Real seconds since boot (UI clock). */
  realTime = 0;
  /** 0..1 world desaturation driven by focus (real-time ramp). */
  focusFilter = 0;
  /** Viewport aspect (width / height), reported by the renderer; used by the camera edge clamp. */
  viewAspect = 16 / 9;
  /** Written by the view layer; shown in debug mode (screen vs internal vs sprite resolution, zoom). */
  renderStats = { screenW: 0, screenH: 0, internalW: 0, internalH: 0, dpr: 1, refScale: 1 };

  setRenderStats(s: Game['renderStats']): void {
    this.renderStats = s;
  }
  private pendingTechnique: string | null = null;
  private pendingTicks = 0;
  private lastFocusNotify = 0;
  private castSeq = 1;
  private analog = { x: 0, y: 0 };
  private stick = { x: 0, y: 0 };
  private wdir = { x: 0, z: 0 };
  private sdir = { x: 0, y: 0 };
  private desiredCam: CameraPose = makePose();
  private combatYaw = 0;
  private lastManualCamTick = -999;
  private projectileSeq = 0;
  private toasts: Toast[] = [];
  private toastSeq = 0;
  private dialogue: { speaker: string; lines: string[]; index: number } | null = null;
  private rewards: RewardSummary | null = null;
  private saveStatus: UiSnapshot['save'] = { status: 'idle', text: '' };
  private saveStatusUntil = 0;
  private uiListeners = new Set<() => void>();
  private ui: UiSnapshot;
  private uiVersion = 0;
  private currentArea: string | null = null;
  private worldKiCooldown = 0;
  private meteoCamActive = false;
  private interpreterCfg = scaledConfig(1);

  constructor() {
    this.loop = new FixedLoop((t) => this.step(t));
    this.sim = new InputReader(this.input, SIM_ACTIONS);
    this.focusReader = new InputReader(this.input, [...FOCUS_BUTTONS.map(([a]) => a), ...FOCUS_DIRS.map(([a]) => a), 'menu']);
    this.projectiles = new ProjectileSystem((p) => this.projectileVsObstacles(p));
    this.ui = this.buildUi();
    this.fsm.transition('MAIN_MENU');
    this.events.on('toast', (t) => this.pushToast(t.text, t.tone ?? 'info'));
    // Focus grants no invulnerability: any hit on the focusing fighter interrupts it.
    this.events.on('hit', (h) => {
      if (this.focus.active && h.defenderId === this.focus.casterId) this.endFocus(this.focus.interrupt());
    });
    this.events.on('limitReady', (l) => {
      const e = this.world.get(l.entityId);
      if (e?.hero) this.pushToast(`¡Límite de ${CHARACTERS[e.hero.characterId].name} listo!`, 'good');
    });
    this.events.on('saved', (s) => {
      this.saveStatus = s.ok ? { status: 'saved', text: `Guardado (${s.reason})` } : { status: 'error', text: `Error al guardar: ${s.error ?? ''}` };
      this.saveStatusUntil = this.playTime + (s.ok ? 3 : 8);
      this.notify();
    });
    this.events.on('levelUp', (l) => this.pushToast(`¡${CHARACTERS[l.characterId].name} sube a nivel ${l.level}!`, 'good'));
    this.events.on('meteoEnd', (m) => this.pushToast(m.defended ? `Meteo Attack: ${m.damage} (defendido)` : `¡Meteo Attack! ${m.damage}`, 'good'));
    this.events.on('coordinated', () => this.pushToast('¡Ataque coordinado!', 'good'));
    this.events.on('parry', (p) => {
      if (this.world.get(p.defenderId)?.combatant?.playerControlled) this.pushToast('¡Parry!', 'good');
    });
  }

  // ---------------------------------------------------------------- setup

  applySettings(s: Settings): void {
    this.settings = s;
    this.interpreterCfg = scaledConfig(s.inputWindowMultiplier);
    this.camera.smoothing = s.cameraSmoothing;
    this.camera.shakeScale = s.reducedMotion ? 0.25 : 1;
  }

  newGame(leaderId: string): void {
    this.roster = {};
    for (const id of Object.keys(CHARACTERS)) this.roster[id] = createMember(id);
    const others = STARTING_PARTY.filter((id) => id !== leaderId);
    this.partyOrder = [leaderId, ...others].slice(0, 3);
    this.leaderId = leaderId;
    this.inventory = new InventoryManager({ herb: 2 });
    this.quests = new QuestManager();
    this.money = 50;
    this.worldState = emptyWorld();
    this.farm = { kills: [] };
    this.gameTime = 0;
    this.playTime = 0;
    this.map = buildValley();
    this.checkpoint = { mapId: 'valley', x: this.map.recovery.x + 1, z: this.map.recovery.z };
    this.spawnWorld(this.map.start.x, this.map.start.z);
    this.enterExploration();
    this.pushToast('Habla con el Maestro Hoku (J para interactuar)', 'quest');
    this.saveManager?.request('nueva partida', true);
  }

  loadSave(d: SaveData): void {
    this.roster = {};
    for (const id of Object.keys(CHARACTERS)) {
      const m = d.roster[id] ?? createMember(id);
      const s = computeStats(m);
      m.hp = clamp(m.hp, 1, s.maxHp);
      m.ki = clamp(m.ki, 0, s.maxKi);
      // Respect the player's slot layout (empty slots stay empty).
      normalizeSlots(m, false);
      this.roster[id] = m;
    }
    this.partyOrder = d.partyOrder.filter((id) => CHARACTERS[id]).slice(0, 3);
    this.leaderId = this.partyOrder.includes(d.leader) ? d.leader : this.partyOrder[0];
    this.inventory = new InventoryManager({ ...d.inventory });
    this.quests = new QuestManager({ ...d.quests });
    this.money = d.money;
    this.worldState = { ...emptyWorld(), ...d.world };
    this.farm = d.farm ?? { kills: [] };
    this.gameTime = d.gameTime;
    this.playTime = d.playTimeSeconds;
    this.checkpoint = d.checkpoint;
    this.map = buildValley();
    this.spawnWorld(d.position.x, d.position.z);
    this.enterExploration();
    this.pushToast('Partida cargada', 'info');
  }

  private enterExploration(): void {
    this.encounter = null;
    this.rewards = null;
    this.dialogue = null;
    this.pb.reset();
    if (this.fsm.state !== 'MAIN_MENU') {
      if (this.fsm.state !== 'PAUSED' && this.fsm.canTransition('PAUSED')) this.fsm.transition('PAUSED');
      this.fsm.transition('MAIN_MENU');
    }
    this.fsm.transition('WORLD_EXPLORATION');
    const leader = this.leader();
    this.controlledId = leader.id;
    this.explorationPose(this.desiredCam);
    this.camera.mode = 'ExplorationCamera';
    this.camera.snap(this.desiredCam);
    this.loop.reset();
    this.notify();
  }

  returnToMenu(): void {
    void this.saveManager?.flush();
    if (this.fsm.state !== 'MAIN_MENU') {
      if (this.fsm.state !== 'PAUSED' && this.fsm.canTransition('PAUSED')) this.fsm.transition('PAUSED');
      if (this.fsm.canTransition('MAIN_MENU')) this.fsm.transition('MAIN_MENU');
    }
    this.notify();
  }

  private spawnWorld(px: number, pz: number): void {
    this.world.clear();
    this.projectileSeq = 0;
    const map = this.map;
    for (const b of map.boulders) {
      if (this.worldState.brokenObstacles.includes(b.id)) continue;
      this.world.create({
        stableId: b.id,
        kind: 'boulder',
        transform: { pos: vec3(b.x, map.tiles.heightAt(b.x, b.z), b.z), prev: vec3(b.x, 0, b.z), yaw: 0 },
        sprite: sprite('prop:boulder', 1.6),
        interactable: { kind: 'boulder', refId: b.id, radius: 1.8, used: false, prompt: 'Examinar roca agrietada' },
      });
      map.tiles.setDynamicBlocker(Math.floor(b.x), Math.floor(b.z), 3);
    }

    this.partyOrder.forEach((id, i) => {
      const m = this.roster[id];
      const def = CHARACTERS[id];
      const c = heroCombatant(id, m, this.allyOrders[id] ?? 'BALANCED');
      const x = px - i * 0.6;
      const z = pz + i * 0.6;
      this.world.create({
        stableId: `hero_${id}`,
        kind: 'hero',
        transform: { pos: vec3(x, map.tiles.heightAt(x, z), z), prev: vec3(x, 0, z), yaw: 0 },
        body: { vel: vec3(), radius: 0.32 * def.appearance.scale, height: 1.5 * def.appearance.scale, grounded: true, flying: false },
        sprite: sprite(`char:${id}`, def.appearance.scale),
        appearance: def.appearance,
        hero: { characterId: id, partyIndex: i },
        combatant: c,
      });
    });
    this.trail.reset(px, pz);

    for (const g of map.enemyGroups) {
      g.members.forEach((mem, i) => {
        if (this.worldState.defeatedPersistent.includes(mem.stableId)) return;
        const respawnAt = this.worldState.enemyRespawnAt[mem.stableId];
        if (respawnAt !== undefined && respawnAt > this.gameTime) return;
        this.spawnEnemy(g.id, mem.stableId, mem.enemyId, g.x + (i % 2) * 1.2 - 0.6, g.z + Math.floor(i / 2) * 1.2, g.patrolRadius);
      });
    }

    for (const n of map.npcs) {
      this.world.create({
        stableId: `npc_${n.id}`,
        kind: 'npc',
        transform: { pos: vec3(n.x, 0, n.z), prev: vec3(n.x, 0, n.z), yaw: 0 },
        sprite: sprite(`npc:${n.appearance}`, NPC_APPEARANCES[n.appearance].scale),
        appearance: NPC_APPEARANCES[n.appearance],
        npc: { appearance: n.appearance, name: n.name },
        interactable: { kind: 'npc', refId: n.id, radius: 1.5, used: false, prompt: `Hablar con ${n.name}` },
      });
    }
    for (const ch of map.chests) {
      const opened = this.worldState.openedChests.includes(ch.id);
      this.world.create({
        stableId: ch.id,
        kind: 'chest',
        transform: { pos: vec3(ch.x, map.tiles.heightAt(ch.x, ch.z), ch.z), prev: vec3(ch.x, 0, ch.z), yaw: 0 },
        sprite: { ...sprite('prop:chest', 1), anim: opened ? 'interact' : 'idle' },
        interactable: { kind: 'chest', refId: ch.id, radius: 1.4, used: opened, prompt: 'Abrir cofre' },
      });
    }
    for (const p of map.pickups) {
      if (this.worldState.collectedPickups.includes(p.id)) continue;
      this.world.create({
        stableId: p.id,
        kind: 'pickup',
        transform: { pos: vec3(p.x, map.tiles.heightAt(p.x, p.z), p.z), prev: vec3(p.x, 0, p.z), yaw: 0 },
        sprite: sprite(ITEMS[p.itemId].type === 'quest' ? 'prop:stone' : 'prop:pickup', 1),
        interactable: { kind: 'pickup', refId: p.id, radius: 0.9, used: false, prompt: '' },
      });
    }
    const r = map.recovery;
    this.world.create({
      stableId: r.id,
      kind: 'recovery',
      transform: { pos: vec3(r.x, 0, r.z), prev: vec3(r.x, 0, r.z), yaw: 0 },
      sprite: sprite('prop:crystal', 1),
      interactable: { kind: 'recovery', refId: r.id, radius: 1.6, used: false, prompt: 'Tocar el cristal (recuperar y guardar)' },
    });
  }

  private spawnEnemy(groupId: string, stableId: string, enemyId: string, x: number, z: number, patrol: number): Entity {
    const def = ENEMIES[enemyId];
    const c = makeCombatant('enemy', def.name, def.level, { ...def.baseStats }, [...def.moves], [], def.aiStyle, 'meteo_strike', [], def.persistentDefeat ? 0.85 : 0.55);
    return this.world.create({
      stableId,
      kind: 'enemy',
      transform: { pos: vec3(x, this.map.tiles.heightAt(x, z), z), prev: vec3(x, 0, z), yaw: 0 },
      body: { vel: vec3(), radius: 0.32 * def.appearance.scale, height: 1.5 * def.appearance.scale, grounded: true, flying: false },
      sprite: sprite(`enemy:${enemyId}`, def.appearance.scale),
      appearance: def.appearance,
      combatant: c,
      explorer: { enemyId, groupId, home: vec3(x, 0, z), patrolRadius: patrol, state: 'IDLE', stateTicks: 0, wanderTarget: vec3(x, 0, z), detectRadius: def.detectRadius, alertTicks: 0 },
    });
  }

  // ---------------------------------------------------------------- queries

  leader(): Entity {
    const e = this.world.getStable(`hero_${this.leaderId}`);
    if (!e) throw new Error('Leader entity missing');
    return e;
  }

  heroes(): Entity[] {
    return this.partyOrder.map((id) => this.world.getStable(`hero_${id}`)).filter((e): e is Entity => !!e);
  }

  controlled(): Entity | undefined {
    return this.world.get(this.controlledId);
  }

  // ---------------------------------------------------------------- frame / tick

  /** Called by the renderer every frame with real elapsed seconds. Returns interpolation alpha. */
  frame(dt: number): number {
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    this.realTime += dt;
    this.pollGamepad();
    if (this.focus.active) this.updateFocus(dt);
    // One multiplier, owned by focus. Hitstop is per-entity and never stacks with it.
    this.timeScale = this.focus.active ? F.timeScale : 1;
    const target = this.focus.active ? 1 : 0;
    this.focusFilter += clamp(target - this.focusFilter, -dt / F.filterRampSeconds, dt / F.filterRampSeconds);
    return this.loop.advance(dt * this.timeScale);
  }

  private get pressed(): Set<BindAction> {
    return this.sim.pressed;
  }

  private held(a: BindAction): boolean {
    return this.sim.held(a);
  }

  private step(tick: number): void {
    stepWind(this.wind, tick, this.settings.reducedMotion);
    this.sampleInput();
    const s = this.fsm.state;
    if (this.focus.active && (s !== 'ACTIVE_COMBAT' || !this.focusCasterValid())) this.endFocus(this.focus.cancel());
    if (this.pressed.has('debug')) {
      this.settings.debug = !this.settings.debug;
      this.notify();
    }
    if (s === 'PAUSED') {
      if (this.pressed.has('menu')) this.resume();
      this.endTick(tick);
      return;
    }
    if (s === 'MAIN_MENU' || s === 'BOOT') {
      this.menuPose(this.desiredCam, tick);
      this.camera.snap(this.desiredCam);
      this.endTick(tick);
      return;
    }
    if (this.pressed.has('menu') && this.fsm.canTransition('PAUSED')) {
      this.pause();
      this.endTick(tick);
      return;
    }

    this.gameTime += TICK_DT;
    this.playTime += TICK_DT;
    for (const e of this.world.entities) {
      e.transform.prev.x = e.transform.pos.x;
      e.transform.prev.y = e.transform.pos.y;
      e.transform.prev.z = e.transform.pos.z;
    }

    switch (s) {
      case 'WORLD_EXPLORATION':
        this.tickExploration(tick, true);
        break;
      case 'ENCOUNTER_TRANSITION':
        this.tickEncounterTransition(tick);
        break;
      case 'ACTIVE_COMBAT':
        this.tickCombat(tick);
        break;
      case 'COMBAT_VICTORY':
        this.tickVictory(tick);
        break;
      case 'COMBAT_DEFEAT':
        this.tickDefeat(tick);
        break;
      case 'RETURN_TO_WORLD':
        this.tickReturn(tick);
        break;
    }
    const inCombat = s === 'ENCOUNTER_TRANSITION' || s === 'ACTIVE_COMBAT' || s === 'COMBAT_VICTORY' || s === 'COMBAT_DEFEAT';
    updateAnimations(this.world.query('sprite'), inCombat, s === 'COMBAT_VICTORY');
    this.updateCamera();
    this.endTick(tick);
  }

  private endTick(tick: number): void {
    this.fsm.tick();
    if (tick % 6 === 0) {
      this.toasts = this.toasts.filter((t) => t.until > this.playTime);
      if (this.saveStatus.status !== 'idle' && this.saveStatus.status !== 'saving' && this.playTime > this.saveStatusUntil) this.saveStatus = { status: 'idle', text: '' };
      this.notify();
    }
  }

  private sampleInput(): void {
    this.sim.sample();
    this.input.stick(this.stick, this.settings.joystickSensitivity);
    screenToWorld(this.wdir, this.stick.x, this.stick.y, this.camera.pose.yaw);
  }

  // ---------------------------------------------------------------- focus combos

  private focusCasterValid(): boolean {
    const e = this.world.get(this.focus.casterId);
    return !!e?.combatant && e.combatant.playerControlled && e.combatant.state !== 'DEFEATED' && e.id === this.controlledId;
  }

  /** Candidates for a focus attempt: equipped sequences (+ limit), or one preselected technique. */
  private focusCandidates(e: Entity, preselect: string | null): { list: FocusCandidate[]; reason: string | null } {
    const c = e.combatant!;
    const ids = preselect ? [preselect] : [...c.slots.filter((s): s is string => !!s), ...(this.roster[e.hero?.characterId ?? '']?.limit ? [this.roster[e.hero!.characterId].limit!] : [])];
    const list: FocusCandidate[] = [];
    let reason: string | null = null;
    for (const id of ids) {
      const m = MOVES[id];
      if (!m?.technique?.sequence) continue;
      const blocked = techniqueBlocker(e, id, this.world);
      if (blocked) {
        reason ??= `${m.name}: ${blocked}`;
        continue;
      }
      for (const s of sequencesOf(m)) list.push({ moveId: id, name: m.name, sequence: s.sequence as FocusSymbol[], mode: s.mode, limit: m.technique.slot === 'limit' });
    }
    return { list, reason: list.length ? null : (reason ?? 'No hay técnicas con secuencia equipadas') };
  }

  /** Starts focus (resources and cooldown are validated here, at sequence start). */
  tryFocus(preselect: string | null = null): boolean {
    if (this.fsm.state !== 'ACTIVE_COMBAT' || this.focus.active) return false;
    const e = this.controlled();
    if (!e?.combatant || !e.hero) return false;
    const c = e.combatant;
    if (this.loop.tick < this.focusReadyTick) {
      this.pushToast(`Concentración en recarga (${Math.ceil((this.focusReadyTick - this.loop.tick) * TICK_DT)} s)`, 'warn');
      return false;
    }
    if (!canAct(c)) return false;
    const { list, reason } = this.focusCandidates(e, preselect);
    if (!list.length) {
      this.pushToast(reason ?? 'No disponible', 'warn');
      return false;
    }
    const target = this.world.get(c.targetId);
    let tx = 1;
    let ty = 0;
    if (target) {
      worldToScreen(this.sdir, target.transform.pos.x - e.transform.pos.x, target.transform.pos.z - e.transform.pos.z, this.camera.pose.yaw);
      tx = this.sdir.x;
      ty = this.sdir.y;
    }
    if (!this.focus.start(e.id, list, preselect, tx, ty)) return false;
    this.focusReader.resync();
    this.buffer.clear();
    clearIntent(c.intent);
    this.events.emit('focusStart', { entityId: e.id, preselected: preselect });
    this.notify();
    return true;
  }

  /** Real-time focus input: buttons become symbols; keys don't repeat; the stick needs neutral. */
  private updateFocus(dt: number): void {
    this.focusReader.sample();
    let out: FocusOutcome | null = null;
    if (this.focusReader.pressed.has('menu')) out = this.focus.cancel();
    for (const [a, dx, dy] of FOCUS_DIRS) if (!out && this.focusReader.pressed.has(a)) out = this.focus.push(this.focus.symbolFor(dx, dy));
    for (const [a, sym] of FOCUS_BUTTONS) if (!out && this.focusReader.pressed.has(a)) out = this.focus.push(sym);
    if (!out) {
      this.analog.x = this.input.touchStick.x + this.input.padStick.x;
      this.analog.y = this.input.touchStick.y + this.input.padStick.y;
      out = this.focus.stick(this.analog.x, this.analog.y);
    }
    if (!out) out = this.focus.update(dt);
    if (out) this.endFocus(out);
    else if (this.focusReader.pressed.size || this.realTime - this.lastFocusNotify > 0.08) {
      this.lastFocusNotify = this.realTime;
      this.notify();
    }
  }

  private endFocus(out: FocusOutcome | null): void {
    if (!out) return;
    const e = this.world.get(out.casterId);
    const c = e?.combatant;
    // Inputs used as symbols must not leak into normal attacks once time resumes.
    this.sim.resync();
    this.buffer.clear();
    this.timeScale = 1;
    if (c && out.result !== 'cancelled') this.focusReadyTick = this.loop.tick + F.cooldownTicks;
    if (c && out.result === 'success' && out.candidate) {
      c.sequenceToken = out.candidate.moveId;
      c.castMode = out.candidate.mode;
      this.pendingTechnique = out.candidate.moveId;
      this.pendingTicks = 15;
    } else if (c && (out.result === 'invalid' || out.result === 'timeout')) {
      // Vulnerable: confused for 1.5 s of normal-speed simulation, extra damage taken, no i-frames.
      c.confusedTicks = F.confusedTicks;
      c.invuln = 0;
      c.moveId = null;
      c.bufferedAction = null;
      const pool = out.remaining.length ? out.remaining : [];
      const limitAttempt = out.preselected ? !!MOVES[out.preselected]?.technique && MOVES[out.preselected].technique!.slot === 'limit' : pool.length > 0 && pool.every((p) => p.limit);
      if (limitAttempt) c.rage = Math.max(0, c.rage * (1 - F.failRageFraction));
      else penalizeKi(c, F.failKiPenalty);
      this.events.emit('confused', { entityId: e!.id, ticks: c.confusedTicks });
      this.pushToast(out.result === 'timeout' ? '¡Tiempo agotado! Confundido' : '¡Secuencia fallida! Confundido', 'warn');
    } else if (out.result === 'interrupted') {
      this.pushToast('Concentración interrumpida', 'warn');
    }
    this.events.emit('focusEnd', { entityId: out.casterId, result: out.result, moveId: out.candidate?.moveId ?? null });
    this.notify();
  }

  /** Slot / limit / focus buttons in combat. */
  private combatTechniqueInput(e: Entity): void {
    const c = e.combatant!;
    if (this.pressed.has('focus')) {
      this.tryFocus(null);
      return;
    }
    if (this.pressed.has('special')) {
      const limit = this.roster[e.hero?.characterId ?? '']?.limit;
      if (limit) this.tryFocus(limit);
      return;
    }
    SLOT_ACTIONS.forEach((a, i) => {
      if (!this.pressed.has(a)) return;
      const id = c.slots[i];
      if (!id) return;
      const t = MOVES[id].technique!;
      if (t.sequence) {
        this.tryFocus(id);
        return;
      }
      // Utilities (Kaioken, Teletransportación) activate directly.
      const blocked = techniqueBlocker(e, id, this.world);
      if (blocked) {
        this.pushToast(`${MOVES[id].name}: ${blocked}`, 'warn');
        return;
      }
      c.sequenceToken = id;
      this.pendingTechnique = id;
      this.pendingTicks = 15;
    });
  }

  private pollGamepad(): void {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] }) : null;
    const pads = nav?.getGamepads?.();
    const pad = pads ? Array.from(pads).find((p) => !!p) : null;
    if (!pad) return;
    const dz = (v: number): number => (Math.abs(v) < 0.2 ? 0 : v);
    this.input.padStick.x = dz(pad.axes[0] ?? 0);
    this.input.padStick.y = -dz(pad.axes[1] ?? 0);
    const map: [number, BindAction][] = [
      [0, 'light'], [1, 'heavy'], [2, 'ki'], [3, 'charge'], [4, 'guard'], [5, 'dash'], [6, 'down'], [7, 'up'], [8, 'nextAlly'], [9, 'menu'], [10, 'special'], [11, 'nextTarget'], [14, 'camLeft'], [15, 'camRight'],
    ];
    for (const [i, a] of map) this.input.setPad(a, !!pad.buttons[i]?.pressed);
  }

  // ---------------------------------------------------------------- exploration

  private tickExploration(tick: number, allowEncounters: boolean): void {
    const leader = this.leader();
    const X = BALANCE.exploration;
    const lc = leader.combatant!;
    const charging = !this.dialogue && allowEncounters && this.held('charge') && lc.ki < lc.stats.maxKi;
    lc.state = charging ? 'CHARGE' : 'IDLE';
    if (this.dialogue) {
      moveGroundBody(leader, this.map.tiles, 0, 0, 0);
      if (this.pressed.has('light')) this.advanceDialogue();
    } else if (charging) {
      // Same manual charge as in combat: immobile, no actions while held.
      moveGroundBody(leader, this.map.tiles, 0, 0, 0);
      chargeKi(lc);
    } else {
      const running = this.held('dash');
      moveGroundBody(leader, this.map.tiles, this.wdir.x, this.wdir.z, running ? X.runSpeed : X.walkSpeed);
      if (this.pressed.has('up')) tryJump(leader);
      if (allowEncounters) {
        if (this.pressed.has('light')) this.interact();
        if (this.pressed.has('ki')) this.worldKiBlast();
        if (this.pressed.has('nextAlly')) this.cycleLeader();
        SLOT_ACTIONS.forEach((a, i) => {
          if (this.pressed.has(a)) this.worldTechnique(lc.slots[i]);
        });
      }
    }
    if (this.worldKiCooldown > 0) this.worldKiCooldown--;
    for (const h of this.heroes()) this.tickWorldVitals(h);
    this.trail.record(leader.transform.pos.x, leader.transform.pos.z);
    const running = this.held('dash');
    let slot = 0;
    for (const h of this.heroes()) {
      if (h === leader) continue;
      followTrail(h, this.map.tiles, this.trail, slot++, running);
    }
    const enemies = this.world.query('explorer');
    this.explorerAI.update(enemies, leader, this.map.tiles, this.rng, (e) => {
      if (allowEncounters && !this.dialogue) this.startEncounter(e);
    });
    this.projectiles.update(this.combatCtx(tick), this.combat);
    this.autoPickups(leader);
    if (tick % 15 === 0) this.checkAreas(leader);
    if (tick % 60 === 0) this.checkRespawns(leader);
  }

  private interactTarget(leader: Entity): Entity | null {
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const e of this.world.query('interactable')) {
      const it = e.interactable!;
      if (it.kind === 'pickup') continue;
      const d = distXZ(e.transform.pos, leader.transform.pos);
      if (d < it.radius && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  private interact(): void {
    const leader = this.leader();
    const e = this.interactTarget(leader);
    if (!e) return;
    const it = e.interactable!;
    switch (it.kind) {
      case 'npc': {
        const npc = this.map.npcs.find((n) => n.id === it.refId)!;
        const updates = this.quests.onTalk(npc.id);
        const lines = [...npc.dialogue];
        for (const u of updates) {
          if (u.kind === 'started') lines.push(`[Misión] ${u.text}: ${QUESTS[u.questId].description}`);
          if (u.kind === 'completed') lines.push(`¡Excelente trabajo! Misión "${u.text}" completada.`);
        }
        this.handleQuestUpdates(updates);
        this.dialogue = { speaker: npc.name, lines, index: 0 };
        e.transform.yaw = Math.atan2(leader.transform.pos.x - e.transform.pos.x, leader.transform.pos.z - e.transform.pos.z);
        this.events.emit('dialogue', { speaker: npc.name, lines });
        break;
      }
      case 'chest': {
        if (it.used) {
          this.pushToast('El cofre está vacío', 'info');
          return;
        }
        const ch = this.map.chests.find((c) => c.id === it.refId)!;
        it.used = true;
        e.sprite!.anim = 'interact';
        this.worldState.openedChests.push(ch.id);
        let important = false;
        for (const item of ch.items) {
          this.giveItem(item.itemId, item.count);
          important ||= ITEMS[item.itemId].important;
        }
        this.money += ch.money;
        this.pushToast(`Cofre: ${ch.items.map((i) => `${ITEMS[i.itemId].name} x${i.count}`).join(', ')} +${ch.money} monedas`, 'good');
        this.saveManager?.request(important ? 'objeto importante' : 'cofre', important);
        break;
      }
      case 'recovery': {
        for (const id of Object.keys(this.roster)) {
          const m = this.roster[id];
          const s = computeStats(m);
          m.hp = s.maxHp;
          m.ki = s.maxKi;
        }
        for (const h of this.heroes()) {
          const c = h.combatant!;
          c.hp = c.stats.maxHp;
          c.ki = c.stats.maxKi;
        }
        this.checkpoint = { mapId: this.map.id, x: e.transform.pos.x + 1, z: e.transform.pos.z };
        this.pushToast('Energía restaurada. Punto de control guardado.', 'good');
        this.saveManager?.request('checkpoint', true);
        break;
      }
      case 'boulder': {
        const breaks = (id: string): boolean => MOVES[id].technique?.effect === 'beam' || !!MOVES[id].projectile?.breaksObstacles;
        const breakers = this.leader()
          .combatant!.slots.filter((s): s is string => !!s && breaks(s))
          .map((s) => MOVES[s].name);
        this.pushToast(breakers.length ? `Roca agrietada: usa ${breakers.join(' o ')} desde tus técnicas` : 'Roca agrietada. Un Kamehameha, un Kienzan o un Sōkidan la romperían.', 'info');
        break;
      }
      default:
        break;
    }
  }

  private advanceDialogue(): void {
    if (!this.dialogue) return;
    this.dialogue.index++;
    if (this.dialogue.index >= this.dialogue.lines.length) this.dialogue = null;
    this.notify();
  }

  closeDialogue(): void {
    this.dialogue = null;
    this.notify();
  }

  private worldKiBlast(): void {
    if (this.worldKiCooldown > 0) return;
    const leader = this.leader();
    const m = getMove('ki_blast');
    if (!spendKi(leader.combatant!, m.kiCost)) {
      this.pushToast('Ki insuficiente', 'warn');
      return;
    }
    this.worldKiCooldown = BALANCE.ki.worldBlastCooldownTicks;
    createProjectile(this.combatCtx(0), leader, m, null, this.projectileSeq++, { castId: this.castSeq++ });
  }

  /** Exploration: cooldowns and limited passive regen use the same ki model as combat. */
  private tickWorldVitals(h: Entity): void {
    const c = h.combatant!;
    for (const k in c.cooldowns) if (c.cooldowns[k] > 0) c.cooldowns[k]--;
    if (c.state !== 'CHARGE') regenKi(c);
  }

  /**
   * Technique used on the map: same unlock, cooldown and ki rules as combat
   * (ki charged once). Utilities only — map casts never damage roaming enemies.
   */
  worldTechnique(id: string | null): boolean {
    if (!id || this.fsm.state !== 'WORLD_EXPLORATION' || this.dialogue) return false;
    const leader = this.leader();
    const c = leader.combatant!;
    const m = MOVES[id];
    const t = m?.technique;
    if (!t) return false;
    if (!t.usableInWorld) {
      this.pushToast(`${m.name} solo se puede usar en combate`, 'info');
      return false;
    }
    if (!c.unlockedMoves.includes(id)) return false;
    if ((c.cooldowns[id] ?? 0) > 0) {
      this.pushToast(`${m.name}: en recarga`, 'warn');
      return false;
    }
    if (!spendKi(c, m.kiCost)) {
      this.pushToast(`${m.name}: ki insuficiente`, 'warn');
      return false;
    }
    if (m.cooldownTicks > 0) c.cooldowns[id] = m.cooldownTicks;
    const castId = this.castSeq++;
    const ctx = this.combatCtx(this.loop.tick);
    const yaw = leader.transform.yaw;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const p = leader.transform.pos;
    const y = p.y + (leader.body?.height ?? 1.4) * 0.55;
    if (t.effect === 'beam') {
      const length = clipLine(this.map.tiles, p.x, p.z, y, dx, dz, t.targeting.range);
      this.events.emit('beamFired', { ownerId: leader.id, x: p.x + dx * 0.5, y, z: p.z + dz * 0.5, dirX: dx, dirZ: dz, length, width: t.targeting.width, ticks: m.active, color: leader.appearance?.palette.aura ?? 0x9ad8ff });
      this.breakObstaclesAlong(p.x, p.z, dx, dz, length + 1.2, t.targeting.width + 1);
    } else if (t.effect === 'flash') {
      let n = 0;
      for (const e of this.world.query('explorer')) {
        if (!isWorldHostile(e) || distXZ(e.transform.pos, p) > t.targeting.width) continue;
        if (!this.map.tiles.lineOfSight(p.x, p.z, e.transform.pos.x, e.transform.pos.z, y + 0.4)) continue;
        // Blinded patrols lose track of the party for a while (no damage).
        e.explorer!.state = 'RETURN';
        e.explorer!.alertTicks = -(t.blindTicks ?? 120) * 2;
        n++;
      }
      this.events.emit('flash', { ownerId: leader.id, x: p.x, y: p.y + 1.2, z: p.z, radius: t.targeting.width, affected: n });
    } else if (m.projectile) {
      createProjectile(ctx, leader, m, null, this.projectileSeq++, { castId, lift: t.pose === 'kienzan' ? (leader.body?.height ?? 1.4) * 0.55 : 0, impacts: t.targeting.maxImpacts });
    }
    leader.sprite!.oneShot = { anim: POSE_ANIM[t.pose], ticks: m.startup + 10 };
    this.events.emit('techniqueUsed', { entityId: leader.id, moveId: id, name: m.name, limit: false });
    return true;
  }

  private breakObstaclesAlong(ox: number, oz: number, dx: number, dz: number, length: number, width: number): void {
    for (const b of [...this.world.query('interactable')]) {
      if (b.kind !== 'boulder') continue;
      const rx = b.transform.pos.x - ox;
      const rz = b.transform.pos.z - oz;
      const along = rx * dx + rz * dz;
      if (along < 0 || along > length || Math.abs(rx * -dz + rz * dx) > width) continue;
      this.destroyBoulder(b);
    }
  }

  private destroyBoulder(b: Entity): void {
    const id = b.stableId;
    this.world.remove(b.id);
    this.map.tiles.clearDynamicBlocker(Math.floor(b.transform.pos.x), Math.floor(b.transform.pos.z));
    if (!this.worldState.brokenObstacles.includes(id)) this.worldState.brokenObstacles.push(id);
    this.events.emit('obstacleBroken', { id, x: b.transform.pos.x, z: b.transform.pos.z });
    this.camera.addTrauma(0.6);
    this.pushToast('¡La roca se ha hecho pedazos!', 'good');
    this.saveManager?.request('obstáculo destruido', true);
  }

  private projectileVsObstacles(p: Entity): boolean {
    const pos = p.transform.pos;
    for (const b of this.world.query('interactable')) {
      if (b.kind !== 'boulder') continue;
      if (distXZ(b.transform.pos, pos) > 1.4 || pos.y > 3) continue;
      if (!p.projectile!.breaksObstacles) return true;
      this.destroyBoulder(b);
      return true;
    }
    return false;
  }

  private autoPickups(leader: Entity): void {
    for (const e of this.world.query('interactable')) {
      if (e.interactable!.kind !== 'pickup') continue;
      if (distXZ(e.transform.pos, leader.transform.pos) > 0.9 || Math.abs(e.transform.pos.y - leader.transform.pos.y) > 1) continue;
      const p = this.map.pickups.find((x) => x.id === e.interactable!.refId)!;
      this.world.remove(e.id);
      this.worldState.collectedPickups.push(p.id);
      this.giveItem(p.itemId, p.count);
      this.pushToast(`Obtienes ${ITEMS[p.itemId].name}`, 'good');
      this.saveManager?.request('objeto', ITEMS[p.itemId].important);
    }
  }

  giveItem(itemId: string, count: number): void {
    this.inventory.add(itemId, count);
    this.events.emit('item', { itemId, count });
    this.handleQuestUpdates(this.quests.onCollect(itemId, this.inventory.count(itemId)));
  }

  private checkAreas(leader: Entity): void {
    const p = leader.transform.pos;
    const area = this.map.areas.find((a) => p.x >= a.x0 && p.x <= a.x1 + 1 && p.z >= a.z0 && p.z <= a.z1 + 1) ?? null;
    const id = area?.id ?? null;
    if (id === this.currentArea) return;
    this.currentArea = id;
    if (!area) return;
    if (!this.worldState.visitedAreas.includes(area.id)) {
      this.worldState.visitedAreas.push(area.id);
      this.pushToast(`Descubres: ${area.name}`, 'info');
    }
    this.handleQuestUpdates(this.quests.onVisit(area.id));
  }

  private checkRespawns(leader: Entity): void {
    for (const g of this.map.enemyGroups) {
      for (const [i, mem] of g.members.entries()) {
        const at = this.worldState.enemyRespawnAt[mem.stableId];
        if (at === undefined || at > this.gameTime || this.world.getStable(mem.stableId)) continue;
        if (Math.hypot(leader.transform.pos.x - g.x, leader.transform.pos.z - g.z) < 14) continue;
        delete this.worldState.enemyRespawnAt[mem.stableId];
        this.spawnEnemy(g.id, mem.stableId, mem.enemyId, g.x + (i % 2) * 1.2 - 0.6, g.z + Math.floor(i / 2) * 1.2, g.patrolRadius);
      }
    }
  }

  private cycleLeader(): void {
    const i = this.partyOrder.indexOf(this.leaderId);
    this.setLeader(this.partyOrder[(i + 1) % this.partyOrder.length]);
  }

  setLeader(id: string): void {
    if (!this.partyOrder.includes(id)) return;
    const old = this.leader();
    this.leaderId = id;
    const nl = this.leader();
    // Swap places so the camera doesn't jump.
    const ox = old.transform.pos.x;
    const oz = old.transform.pos.z;
    old.transform.pos.x = nl.transform.pos.x;
    old.transform.pos.z = nl.transform.pos.z;
    nl.transform.pos.x = ox;
    nl.transform.pos.z = oz;
    nl.transform.pos.y = this.map.tiles.heightAt(ox, oz);
    this.controlledId = nl.id;
    this.trail.reset(ox, oz);
    this.pushToast(`Líder: ${CHARACTERS[id].name}`, 'info');
    this.notify();
  }

  // ---------------------------------------------------------------- encounters

  startEncounter(trigger: Entity): boolean {
    if (this.fsm.state !== 'WORLD_EXPLORATION' || !trigger.explorer) return false;
    const groupId = trigger.explorer.groupId;
    const enemies = this.world
      .query('explorer')
      .filter((e) => e.explorer!.groupId === groupId && e.explorer!.state !== 'DEFEATED' && distXZ(e.transform.pos, trigger.transform.pos) < 12)
      .slice(0, 3);
    const heroes = this.heroes();
    const leader = this.leader();
    let cx = 0;
    let cz = 0;
    for (const e of enemies) {
      cx += e.transform.pos.x;
      cz += e.transform.pos.z;
    }
    cx /= enemies.length;
    cz /= enemies.length;
    let ax = cx - leader.transform.pos.x;
    let az = cz - leader.transform.pos.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    const center = vec3((cx + leader.transform.pos.x) / 2, 0, (cz + leader.transform.pos.z) / 2);
    center.y = this.map.tiles.heightAt(center.x, center.z);
    const formation = new Map<number, Vec3>();
    const place = (list: Entity[], side: number): void => {
      list.forEach((e, i) => {
        const lat = (i - (list.length - 1) / 2) * 2.2;
        const fx = center.x + ax * 2.6 * side - az * lat;
        const fz = center.z + az * 2.6 * side + ax * lat;
        formation.set(e.id, vec3(fx, Math.max(this.map.tiles.heightAt(fx, fz), center.y) + BALANCE.combat.hoverHeight, fz));
      });
    };
    place(heroes, -1);
    place(enemies, 1);

    for (const e of [...heroes, ...enemies]) {
      const c = e.combatant!;
      c.engaged = true;
      c.state = 'IDLE';
      c.stateTicks = 0;
      c.moveId = null;
      c.meteo = null;
      c.meteoVictim = false;
      c.comboCount = 0;
      c.hitstun = 0;
      c.hitstop = 0;
      c.confusedTicks = 0;
      c.blindTicks = 0;
      c.sequenceToken = null;
      c.playerControlled = e === leader;
      c.ai.decisionCooldown = 0;
      c.ai.techniqueCooldown = BALANCE.ai.allyTechniqueOpeningTicks;
      clearIntent(c.intent);
      e.body!.flying = true;
      e.body!.vel.x = e.body!.vel.y = e.body!.vel.z = 0;
      if (e.explorer) e.explorer.state = 'IN_COMBAT';
      if (e.hero) c.ai.order = this.allyOrders[e.hero.characterId] ?? 'BALANCED';
    }
    for (const e of [...heroes, ...enemies]) {
      let best: Entity | null = null;
      let bd = Infinity;
      for (const o of e.combatant!.team === 'player' ? enemies : heroes) {
        const d = distXZ(o.transform.pos, e.transform.pos);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      e.combatant!.targetId = best ? best.id : -1;
    }
    this.encounter = { groupId, heroIds: heroes.map((h) => h.id), enemyIds: enemies.map((e) => e.id), arena: { center, radius: BALANCE.combat.arenaRadius }, formation };
    this.controlledId = leader.id;
    this.pb.reset();
    this.buffer.clear();
    this.combatYaw = yawForScreenRight(ax, az);
    this.lastManualCamTick = -999;
    this.camera.setMode('EncounterCamera', BALANCE.transition.encounterTicks);
    this.fsm.transition('ENCOUNTER_TRANSITION');
    this.events.emit('encounterStart', { groupId });
    const boss = enemies.some((e) => ENEMIES[e.explorer!.enemyId].persistentDefeat);
    this.pushToast(boss ? `¡${enemies[0].combatant!.name} te desafía!` : '¡Combate!', 'warn');
    this.notify();
    return true;
  }

  private engaged(): Entity[] {
    if (!this.encounter) return [];
    const out: Entity[] = [];
    for (const id of this.encounter.heroIds) {
      const e = this.world.get(id);
      if (e) out.push(e);
    }
    for (const id of this.encounter.enemyIds) {
      const e = this.world.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  private combatCtx(tick: number): CombatContext {
    return {
      world: this.world,
      map: this.map.tiles,
      pb: this.pb,
      events: this.events,
      rng: this.rng,
      tick,
      arena: this.encounter?.arena ?? { center: vec3(), radius: 999 },
      spawnProjectile: (owner, move, target, opts) => createProjectile(this.combatCtx(tick), owner, move, target, this.projectileSeq++, opts),
      nextCastId: () => this.castSeq++,
    };
  }

  private tickEncounterTransition(tick: number): void {
    const t = this.fsm.stateTicks;
    const T = BALANCE.transition;
    const list = this.engaged();
    for (const e of list) {
      const c = e.combatant!;
      const active = c.playerControlled ? t >= T.playerControlAfterTicks : t >= (c.team === 'player' ? 12 : 18);
      if (!active) clearIntent(c.intent);
    }
    this.combatInputAndAI(tick, t >= T.playerControlAfterTicks);
    for (const e of list) {
      const c = e.combatant!;
      const active = c.playerControlled ? t >= T.playerControlAfterTicks : t >= (c.team === 'player' ? 12 : 18);
      if (active) continue;
      // Smoothly redistribute into the battle formation while the camera tilts.
      const f = this.encounter!.formation.get(e.id);
      if (!f) continue;
      const k = damp(6, TICK_DT);
      e.transform.pos.x += (f.x - e.transform.pos.x) * k;
      e.transform.pos.z += (f.z - e.transform.pos.z) * k;
      e.transform.pos.y += (f.y - e.transform.pos.y) * k;
    }
    if (t >= T.encounterTicks) {
      this.camera.setMode('CombatCamera', 1);
      this.fsm.transition('ACTIVE_COMBAT');
    }
  }

  private combatInputAndAI(tick: number, playerActive: boolean): void {
    const ctl = this.controlled();
    const list = this.engaged();
    if (ctl && playerActive) {
      if (this.pressed.has('nextAlly') && !this.focus.active) this.cycleControlled();
      const c2 = this.controlled();
      if (c2) this.playerCombatIntent(c2, tick);
    } else if (ctl) {
      clearIntent(ctl.combatant!.intent);
    }
    if (this.pb.dominance === 'player') {
      for (const e of list) {
        if (e.combatant!.team === 'player' && rageFromDominance(e.combatant!) && e.hero) this.events.emit('limitReady', { entityId: e.id, characterId: e.hero.characterId });
      }
    }
    const leaderTarget = this.controlled()?.combatant?.targetId ?? -1;
    this.combatAI.update(list, { world: this.world, pb: this.pb, rng: this.rng, tick, leaderTargetId: leaderTarget });
    const ctx = this.combatCtx(tick);
    const domBefore = this.pb.dominance;
    this.combat.update(ctx, list);
    this.projectiles.update(ctx, this.combat);
    this.pb.tick();
    if (this.pb.dominance !== domBefore) {
      this.events.emit('dominance', { team: this.pb.dominance });
      if (this.pb.dominance === 'player') this.pushToast('¡DOMINIO! Tu furia crece más rápido', 'good');
      else if (this.pb.dominance === 'enemy') this.pushToast('¡El enemigo domina el combate! Defiéndete (U)', 'warn');
    }
  }

  private playerCombatIntent(e: Entity, tick: number): void {
    const c = e.combatant!;
    const i = c.intent;
    clearIntent(i);
    if (c.state === 'DEFEATED') {
      this.cycleControlled();
      return;
    }
    // While focusing, every input is a sequence symbol: no movement or normal attacks.
    if (this.focus.active && this.focus.casterId === e.id) return;
    if (this.pendingTechnique) {
      if (c.moveId === this.pendingTechnique || c.sequenceToken !== this.pendingTechnique) {
        this.pendingTechnique = null;
      } else if (this.pendingTicks-- > 0) {
        i.technique = this.pendingTechnique;
        return;
      } else {
        this.pushToast(`${MOVES[this.pendingTechnique].name}: no se pudo ejecutar`, 'warn');
        c.sequenceToken = null;
        this.pendingTechnique = null;
      }
    }
    i.moveX = this.wdir.x;
    i.moveZ = this.wdir.z;
    i.moveY = (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0);
    i.guard = this.held('guard');
    i.charge = this.held('charge');
    if (this.pressed.has('nextTarget')) {
      const t = cycleTarget(e, this.engaged());
      if (t) c.targetId = t.id;
    }
    this.combatTechniqueInput(e);
    if (this.focus.active) return;
    let held = 0;
    // A tap shorter than one tick still registers as a press for the command buffer.
    for (const b of BUTTONS) if (this.held(b) || this.pressed.has(b)) held |= BUTTON_BITS[b];
    const target = this.world.get(c.targetId);
    let tx = 1;
    let ty = 0;
    if (target) {
      worldToScreen(this.sdir, target.transform.pos.x - e.transform.pos.x, target.transform.pos.z - e.transform.pos.z, this.camera.pose.yaw);
      tx = this.sdir.x;
      ty = this.sdir.y;
    }
    const dir = relativeDir(this.stick.x, this.stick.y, tx, ty);
    this.buffer.push(tick, dir, held);
    const cmd = interpretCommand(this.buffer, c.unlockedMoves, this.interpreterCfg);
    if (cmd === 'air_chase') {
      const lt = this.world.get(c.lastLaunchedTarget);
      if (lt && lt.combatant?.state === 'LAUNCHED' && tick - c.lastLaunchTick < 120) i.action = cmd;
      else i.dash = true;
    } else if (cmd) i.action = cmd;
    if (!i.action && this.pressed.has('dash')) i.dash = true;
  }

  private cycleControlled(): void {
    const heroes = this.engaged().filter((e) => e.combatant!.team === 'player' && isAlive(e));
    if (heroes.length === 0) return;
    const idx = heroes.findIndex((h) => h.id === this.controlledId);
    const next = heroes[(idx + 1) % heroes.length];
    const prev = this.controlled();
    if (prev?.combatant) {
      prev.combatant.playerControlled = false;
      prev.combatant.ai.decisionCooldown = 0;
    }
    next.combatant!.playerControlled = true;
    clearIntent(next.combatant!.intent);
    this.controlledId = next.id;
    this.buffer.clear();
    this.notify();
  }

  private tickCombat(tick: number): void {
    this.combatInputAndAI(tick, true);
    const list = this.engaged();
    const heroesAlive = list.some((e) => e.combatant!.team === 'player' && e.combatant!.state !== 'DEFEATED');
    const enemiesAlive = list.some((e) => e.combatant!.team === 'enemy' && e.combatant!.state !== 'DEFEATED');
    const meteoRunning = list.some((e) => e.combatant!.meteo);
    if (meteoRunning) return;
    if (!enemiesAlive) this.onVictory();
    else if (!heroesAlive) {
      this.fsm.transition('COMBAT_DEFEAT');
      this.pushToast('Tu grupo ha caído...', 'warn');
    }
  }

  private onVictory(): void {
    const enc = this.encounter!;
    const enemies = enc.enemyIds.map((id) => this.world.get(id)).filter((e): e is Entity => !!e);
    const participants = enc.heroIds.map((id) => this.world.get(id)).filter((e): e is Entity => !!e);
    const P = BALANCE.progression;
    const partyLevel = Math.max(...participants.map((p) => p.combatant!.level));
    let xp = 0;
    let ap = 0;
    let money = 0;
    let penalty = false;
    const items: RewardSummary['items'] = [];
    const questUpdates: QuestUpdate[] = [];
    for (const e of enemies) {
      const def = ENEMIES[e.explorer!.enemyId];
      const mult = farmMultiplier(this.farm, def.id, this.gameTime) * levelGapMultiplier(partyLevel, def.level);
      if (mult < 1) penalty = true;
      xp += Math.round(def.xp * mult);
      ap += mult >= 0.5 ? def.ap : 0;
      money += Math.round(def.money * mult);
      recordKill(this.farm, def.id, this.gameTime);
      for (const drop of LootTableManager.roll(def.lootTable, this.rng)) {
        this.inventory.add(drop.itemId, drop.count);
        items.push({ itemId: drop.itemId, name: ITEMS[drop.itemId].name, count: drop.count });
        questUpdates.push(...this.quests.onCollect(drop.itemId, this.inventory.count(drop.itemId)));
      }
      if (def.persistentDefeat) this.worldState.defeatedPersistent.push(e.stableId);
      else this.worldState.enemyRespawnAt[e.stableId] = this.gameTime + def.respawnSeconds;
      e.explorer!.state = 'DEFEATED';
      questUpdates.push(...this.quests.onDefeat(def.id));
    }
    const levelUps: RewardSummary['levelUps'] = [];
    for (const id of Object.keys(this.roster)) {
      const m = this.roster[id];
      const inParty = this.partyOrder.includes(id);
      const share = inParty ? 1 : P.inactiveAllyXpShare;
      const hero = this.world.getStable(`hero_${id}`);
      if (hero?.combatant) {
        m.hp = hero.combatant.state === 'DEFEATED' ? Math.ceil(hero.combatant.stats.maxHp * 0.25) : hero.combatant.hp;
        m.ki = hero.combatant.ki;
        m.rage = hero.combatant.rage;
      }
      const r = grantXp(m, xp * share);
      if (inParty) m.ap += ap;
      if (r.levelsGained > 0) {
        levelUps.push({ name: CHARACTERS[id].name, level: r.newLevel });
        this.events.emit('levelUp', { characterId: id, level: r.newLevel });
      }
    }
    this.money += money;
    questUpdates.push(...this.quests.onApEarned(ap));
    this.handleQuestUpdates(questUpdates);
    this.refreshHeroCombatants();
    this.rewards = { xp, ap, money, items, levelUps, farmPenalty: penalty };
    this.fsm.transition('COMBAT_VICTORY');
    this.events.emit('encounterEnd', { victory: true });
    this.notify();
  }

  private tickVictory(tick: number): void {
    // Simulation keeps running: defeated fall, survivors hover in victory pose.
    const ctx = this.combatCtx(tick);
    for (const e of this.engaged()) clearIntent(e.combatant!.intent);
    this.combat.update(ctx, this.engaged());
    this.projectiles.update(ctx, this.combat);
    if (this.fsm.stateTicks >= BALANCE.transition.victoryTicks) this.beginReturn(false);
  }

  private tickDefeat(tick: number): void {
    const ctx = this.combatCtx(tick);
    for (const e of this.engaged()) clearIntent(e.combatant!.intent);
    this.combatAI.update(this.engaged(), { world: this.world, pb: this.pb, rng: this.rng, tick, leaderTargetId: -1 });
    this.combat.update(ctx, this.engaged());
    if (this.fsm.stateTicks >= BALANCE.transition.defeatTicks) this.beginReturn(true);
  }

  private beginReturn(defeat: boolean): void {
    const enc = this.encounter!;
    for (const e of this.engaged()) {
      const c = e.combatant!;
      c.engaged = false;
      c.playerControlled = false;
      c.meteo = null;
      c.meteoVictim = false;
      c.state = 'IDLE';
      c.buff = null;
      c.confusedTicks = 0;
      c.blindTicks = 0;
      c.sequenceToken = null;
      if (e.sprite) {
        e.sprite.auraColor = null;
        e.sprite.strain = false;
      }
      e.body!.flying = false;
    }
    this.pendingTechnique = null;
    if (defeat) {
      for (const id of enc.enemyIds) {
        const e = this.world.get(id);
        if (!e) continue;
        e.combatant!.hp = e.combatant!.stats.maxHp;
        e.combatant!.ki = e.combatant!.stats.maxKi;
        e.explorer!.state = 'RETURN';
        e.explorer!.alertTicks = -300;
        e.transform.pos.x = e.explorer!.home.x;
        e.transform.pos.z = e.explorer!.home.z;
        e.transform.pos.y = this.map.tiles.heightAt(e.transform.pos.x, e.transform.pos.z);
        if (e.sprite) e.sprite.alpha = 1;
      }
      for (const id of Object.keys(this.roster)) {
        const m = this.roster[id];
        const s = computeStats(m);
        const hero = this.world.getStable(`hero_${id}`)?.combatant;
        if (hero) {
          m.ki = hero.ki;
          m.rage = hero.rage;
        }
        m.hp = s.maxHp;
        // Waking up at the checkpoint is not a free ki refill.
        m.ki = Math.max(m.ki, s.maxKi * BALANCE.ki.afterDefeatFraction);
      }
      this.refreshHeroCombatants();
      const cp = this.checkpoint;
      this.heroes().forEach((h, i) => {
        h.transform.pos.x = cp.x - i * 0.5;
        h.transform.pos.z = cp.z + i * 0.5;
        h.transform.pos.y = this.map.tiles.heightAt(h.transform.pos.x, h.transform.pos.z);
        h.transform.prev.x = h.transform.pos.x;
        h.transform.prev.z = h.transform.pos.z;
      });
      this.pushToast('Despiertas junto al cristal del valle.', 'info');
    } else {
      for (const h of this.heroes()) {
        const m = this.roster[h.hero!.characterId];
        h.combatant!.hp = m.hp;
      }
    }
    const leader = this.leader();
    this.trail.reset(leader.transform.pos.x, leader.transform.pos.z);
    this.controlledId = leader.id;
    this.fsm.transition('RETURN_TO_WORLD');
    if (defeat) {
      this.explorationPose(this.desiredCam);
      this.camera.mode = 'ExplorationCamera';
      this.camera.snap(this.desiredCam);
    } else {
      this.camera.setMode('ExplorationCamera', BALANCE.transition.returnTicks);
    }
  }

  private tickReturn(tick: number): void {
    this.tickExploration(tick, false);
    const enc = this.encounter;
    const t = this.fsm.stateTicks / BALANCE.transition.returnTicks;
    if (enc) {
      for (const id of enc.enemyIds) {
        const e = this.world.get(id);
        if (e?.explorer?.state === 'DEFEATED' && e.sprite) {
          e.sprite.alpha = clamp(1 - t * 1.2, 0, 1);
          e.body!.vel.y -= BALANCE.exploration.gravity * TICK_DT;
          e.transform.pos.y = Math.max(this.map.tiles.heightAt(e.transform.pos.x, e.transform.pos.z), e.transform.pos.y + e.body!.vel.y * TICK_DT);
        }
      }
    }
    if (this.fsm.stateTicks >= BALANCE.transition.returnTicks) {
      if (enc) {
        for (const id of enc.enemyIds) {
          const e = this.world.get(id);
          if (e?.explorer?.state === 'DEFEATED') this.world.remove(id);
        }
      }
      this.encounter = null;
      this.rewards = null;
      this.pb.reset();
      this.fsm.transition('WORLD_EXPLORATION');
      this.saveManager?.request('fin de combate', true);
      this.notify();
    }
  }

  private refreshHeroCombatants(): void {
    this.syncRosterVitals();
    for (const h of this.heroes()) {
      const m = this.roster[h.hero!.characterId];
      const c = h.combatant!;
      c.stats = computeStats(m);
      c.level = m.level;
      c.unlockedMoves = unlockedMoves(m);
      if (m.limit) c.unlockedMoves.push(m.limit);
      c.passives = passivesOf(m);
      c.slots = [...m.slots];
      c.mastery = masteryOf(m);
      c.rage = m.rage;
      c.hp = clamp(m.hp, 0, c.stats.maxHp);
      c.ki = clamp(m.ki, 0, c.stats.maxKi);
    }
  }

  private handleQuestUpdates(updates: QuestUpdate[]): void {
    const all = [...updates];
    all.push(...this.quests.syncInventory((id) => this.inventory.count(id)));
    for (const u of all) {
      if (u.kind === 'started') this.pushToast(`Nueva misión: ${u.text}`, 'quest');
      else if (u.kind === 'step') this.pushToast(`Objetivo: ${u.text}`, 'quest');
      else {
        const q = QUESTS[u.questId];
        this.pushToast(`¡Misión completada: ${u.text}!`, 'quest');
        for (const id of this.partyOrder) {
          const m = this.roster[id];
          const r = grantXp(m, q.rewards.xp);
          m.ap += q.rewards.ap;
          if (r.levelsGained > 0) this.events.emit('levelUp', { characterId: id, level: r.newLevel });
        }
        this.money += q.rewards.money;
        for (const it of q.rewards.items) this.inventory.add(it.itemId, it.count);
        this.refreshHeroCombatants();
        this.saveManager?.request('misión completada', true);
      }
    }
    if (all.length) this.notify();
  }

  // ---------------------------------------------------------------- camera

  explorationPose(out: CameraPose): CameraPose {
    const l = this.leader();
    out.focus.x = l.transform.pos.x;
    out.focus.y = l.transform.pos.y;
    out.focus.z = l.transform.pos.z;
    const X = BALANCE.camera.exploration;
    out.yaw = 0;
    out.pitch = X.pitch;
    out.distance = X.distance * BALANCE.camera.zoomOut;
    out.fov = X.fov;
    return out;
  }

  /** Attract-mode orbit over the village behind the main menu. */
  private menuPose(out: CameraPose, tick: number): CameraPose {
    out.focus.x = 22;
    out.focus.y = 0;
    out.focus.z = 16;
    out.yaw = this.settings.reducedMotion ? 0.4 : tick * 0.0015;
    out.pitch = 0.48;
    out.distance = 22;
    out.fov = 68;
    return out;
  }

  private combatPose(out: CameraPose): CameraPose {
    const ctl = this.controlled() ?? this.leader();
    const target = this.world.get(ctl.combatant!.targetId);
    const p = ctl.transform.pos;
    // The chosen fighter stays at the centre. Distance only reacts to the
    // current target, and only up to a cap, so a spread-out party cannot
    // pull the camera off the battle or farther than exploration.
    let gap = 4.5;
    if (target && isAlive(target)) gap = Math.min(7, Math.hypot(target.transform.pos.x - p.x, target.transform.pos.z - p.z));
    const camRot = (this.held('camRight') ? 1 : 0) - (this.held('camLeft') ? 1 : 0);
    if (camRot !== 0) {
      this.combatYaw += camRot * 2.2 * TICK_DT;
      this.lastManualCamTick = this.loop.tick;
    } else if (target && this.loop.tick - this.lastManualCamTick > 120) {
      // Gentle auto-framing so attacker and target don't overlap in depth.
      const base = yawForScreenRight(target.transform.pos.x - p.x, target.transform.pos.z - p.z);
      const alt = base + Math.PI;
      const pick = Math.abs(wrapAngle(base - this.combatYaw)) < Math.abs(wrapAngle(alt - this.combatYaw)) ? base : alt;
      this.combatYaw = lerpAngle(this.combatYaw, pick, (this.settings.reducedMotion ? 0.15 : 0.5) * TICK_DT);
    }
    out.focus.x = p.x;
    out.focus.y = p.y;
    out.focus.z = p.z;
    const K = BALANCE.camera.combat;
    out.yaw = this.combatYaw;
    out.pitch = K.pitch;
    out.distance = clamp(K.base + gap * K.perSpread, K.min, K.max) * BALANCE.camera.zoomOut;
    out.fov = K.fov;
    return out;
  }

  private meteoPose(out: CameraPose, attacker: Entity): boolean {
    const m = attacker.combatant!.meteo!;
    const v = this.world.get(m.targetId);
    if (!v) return false;
    out.focus.x = (v.transform.pos.x + attacker.transform.pos.x) / 2;
    out.focus.y = v.transform.pos.y + 0.8;
    out.focus.z = (v.transform.pos.z + attacker.transform.pos.z) / 2;
    out.yaw = this.combatYaw + (this.settings.reducedMotion ? 0 : Math.sin(m.tick * 0.03) * 0.7);
    out.pitch = 0.62;
    out.distance = 7.5;
    out.fov = 44;
    return true;
  }

  private updateCamera(): void {
    const s = this.fsm.state;
    const inBattle = s === 'ENCOUNTER_TRANSITION' || s === 'ACTIVE_COMBAT' || s === 'COMBAT_VICTORY' || s === 'COMBAT_DEFEAT';
    if (inBattle) {
      const meteoAttacker = this.engaged().find((e) => e.combatant!.meteo);
      if (meteoAttacker && this.meteoPose(this.desiredCam, meteoAttacker)) {
        if (!this.meteoCamActive) {
          this.meteoCamActive = true;
          this.camera.setMode('SpecialAttackCamera', 12);
        }
      } else {
        if (this.meteoCamActive) {
          this.meteoCamActive = false;
          this.camera.setMode('CombatCamera', 16);
        }
        this.combatPose(this.desiredCam);
        if (s === 'COMBAT_VICTORY') {
          const cap = BALANCE.camera.exploration.distance * BALANCE.camera.zoomOut;
          this.desiredCam.distance = Math.min(cap, this.desiredCam.distance + this.fsm.stateTicks * 0.012);
        }
      }
    } else {
      this.explorationPose(this.desiredCam);
    }
    this.camera.update(this.desiredCam, TICK_DT);
    // Follow smoothing and the encounter blend may slide the look-at point.
    // The chosen character is put back at the centre every tick, on every aspect.
    this.lockCameraOnSubject();
  }

  /** Look-at point of the character the player is controlling right now. */
  private lockCameraOnSubject(): void {
    const s = this.fsm.state;
    const battle = s === 'ENCOUNTER_TRANSITION' || s === 'ACTIVE_COMBAT' || s === 'COMBAT_VICTORY' || s === 'COMBAT_DEFEAT';
    const e = (battle ? this.controlled() : undefined) ?? this.leader();
    const p = e.transform.pos;
    const f = this.camera.pose.focus;
    f.x = p.x;
    f.y = p.y;
    f.z = p.z;
  }

  // ---------------------------------------------------------------- pause / UI actions

  pause(): void {
    if (!this.fsm.canTransition('PAUSED') || this.fsm.state === 'PAUSED') return;
    this.endFocus(this.focus.cancel());
    this.fsm.transition('PAUSED');
    this.input.releaseAll();
    this.notify();
  }

  resume(): void {
    if (this.fsm.state !== 'PAUSED') return;
    this.fsm.resume();
    this.input.releaseAll();
    this.sim.resync();
    this.loop.reset();
    this.notify();
  }

  /** App went to background: pause and flush a save while the OS allows it. */
  suspend(): void {
    this.pause();
    if (this.fsm.previous === 'WORLD_EXPLORATION' || this.fsm.state === 'WORLD_EXPLORATION') this.saveManager?.request('suspensión', true);
  }

  completedQuests(): string[] {
    return Object.keys(QUESTS).filter((id) => this.quests.get(id).status === 'completed');
  }

  purchaseSkill(characterId: string, skillId: string): string | null {
    const m = this.roster[characterId];
    this.syncRosterVitals();
    const r = purchaseSkill(m, skillId, this.completedQuests());
    if (!r.ok) return r.reason;
    this.refreshHeroCombatants();
    this.handleQuestUpdates(this.quests.onSkillUnlocked());
    this.pushToast(`${CHARACTERS[characterId].name} aprende una técnica`, 'good');
    this.saveManager?.request('habilidad comprada', true);
    this.notify();
    return null;
  }

  /** Reassign a technique slot. Only outside combat; saved immediately (verified write). */
  setSlot(characterId: string, index: number, moveId: string | null): boolean {
    if (this.encounter) return false;
    const m = this.roster[characterId];
    if (!m) return false;
    this.syncRosterVitals();
    if (!assignSlot(m, index, moveId)) return false;
    this.refreshHeroCombatants();
    this.saveManager?.request('técnicas', true);
    this.notify();
    return true;
  }

  techniquesOf(characterId: string): { id: string; name: string; status: string; aliases: string[]; note: string; kiCost: number; sequence: FocusSymbol[] | null; description: string; world: boolean }[] {
    const m = this.roster[characterId];
    if (!m) return [];
    return unlockedTechniques(m).map((id) => {
      const mv = MOVES[id];
      const t = mv.technique!;
      return { id, name: mv.name, status: NAME_STATUS_LABEL[t.nameStatus], aliases: t.aliases, note: t.note, kiCost: mv.kiCost, sequence: t.sequence, description: mv.description, world: t.usableInWorld };
    });
  }

  equip(characterId: string, itemId: string): boolean {
    const ok = EquipmentManager.equip(this.roster[characterId], itemId, this.inventory);
    if (ok) {
      this.refreshHeroCombatants();
      this.saveManager?.request('equipamiento', true);
      this.notify();
    }
    return ok;
  }

  unequip(characterId: string, slot: EquipSlot): boolean {
    const ok = EquipmentManager.unequip(this.roster[characterId], slot, this.inventory);
    if (ok) {
      this.refreshHeroCombatants();
      this.saveManager?.request('equipamiento', true);
      this.notify();
    }
    return ok;
  }

  useItem(itemId: string, characterId: string): boolean {
    this.syncRosterVitals();
    const ok = this.inventory.use(itemId, this.roster[characterId]);
    if (ok) {
      this.refreshHeroCombatants();
      this.saveManager?.request('objeto usado');
      this.notify();
    }
    return ok;
  }

  setAllyOrder(characterId: string, order: AiBrain['order']): void {
    this.allyOrders[characterId] = order;
    const e = this.world.getStable(`hero_${characterId}`);
    if (e?.combatant) e.combatant.ai.order = order;
    this.notify();
  }

  setPartyOrder(order: string[]): void {
    if (this.fsm.state !== 'PAUSED' || this.fsm.previous !== 'WORLD_EXPLORATION') return;
    if (order.length === 0 || order.length > 3) return;
    this.syncRosterVitals();
    const leader = this.leader().transform.pos;
    this.partyOrder = order;
    this.leaderId = order[0];
    // Respawn heroes only, keeping the rest of the world intact.
    for (const e of [...this.world.entities]) if (e.kind === 'hero') this.world.remove(e.id);
    this.partyOrder.forEach((id, i) => {
      const m = this.roster[id];
      const def = CHARACTERS[id];
      const c = heroCombatant(id, m, this.allyOrders[id] ?? 'BALANCED');
      this.world.create({
        stableId: `hero_${id}`,
        kind: 'hero',
        transform: { pos: vec3(leader.x - i * 0.5, leader.y, leader.z + i * 0.5), prev: vec3(leader.x, leader.y, leader.z), yaw: 0 },
        body: { vel: vec3(), radius: 0.32 * def.appearance.scale, height: 1.5 * def.appearance.scale, grounded: true, flying: false },
        sprite: sprite(`char:${id}`, def.appearance.scale),
        appearance: def.appearance,
        hero: { characterId: id, partyIndex: i },
        combatant: c,
      });
    });
    this.controlledId = this.leader().id;
    this.trail.reset(leader.x, leader.z);
    this.saveManager?.request('grupo');
    this.notify();
  }

  private syncRosterVitals(): void {
    if (this.encounter) return;
    for (const h of this.heroes()) {
      const m = this.roster[h.hero!.characterId];
      m.hp = h.combatant!.hp;
      m.ki = h.combatant!.ki;
      m.rage = h.combatant!.rage;
    }
  }

  // ---------------------------------------------------------------- debug

  debugAddPower(amount: number): void {
    this.pb.add('player', amount);
    if (this.pb.dominance) this.events.emit('dominance', { team: this.pb.dominance });
    this.notify();
  }

  debugSetRage(value: number): void {
    for (const h of this.heroes()) h.combatant!.rage = clamp(value, 0, BALANCE.rage.max);
    this.notify();
  }

  /** Resolves one hit through the real combat path (hostility, confusion, rage). Returns HP lost. */
  debugHit(attackerId: number, defenderId: number, moveId: string): number {
    const a = this.world.get(attackerId);
    const d = this.world.get(defenderId);
    if (!a?.combatant || !d?.combatant || !MOVES[moveId]) return 0;
    const before = d.combatant.hp;
    this.combat.applyHit(a, d, MOVES[moveId], 1, 0, this.combatCtx(this.loop.tick));
    return before - d.combatant.hp;
  }

  debugGrant(xp: number, ap: number): void {
    for (const id of this.partyOrder) {
      const m = this.roster[id];
      const r = grantXp(m, xp);
      m.ap += ap;
      if (r.levelsGained) this.events.emit('levelUp', { characterId: id, level: r.newLevel });
    }
    if (ap > 0) this.handleQuestUpdates(this.quests.onApEarned(ap));
    this.refreshHeroCombatants();
    this.notify();
  }

  /** Teleports the nearest living enemy group next to the player and starts the encounter. */
  debugEncounter(): boolean {
    if (this.fsm.state === 'PAUSED') this.resume();
    if (this.fsm.state !== 'WORLD_EXPLORATION') return false;
    const leader = this.leader();
    let best: Entity | null = null;
    let bd = Infinity;
    for (const e of this.world.query('explorer')) {
      if (e.explorer!.state === 'DEFEATED') continue;
      const d = distXZ(e.transform.pos, leader.transform.pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) return false;
    for (const e of this.world.query('explorer')) {
      if (e.explorer!.groupId !== best.explorer!.groupId || e.explorer!.state === 'DEFEATED') continue;
      e.transform.pos.x = leader.transform.pos.x + 2 + this.rng.range(-0.5, 0.5);
      e.transform.pos.z = leader.transform.pos.z + this.rng.range(-1, 1);
    }
    return this.startEncounter(best);
  }

  // ---------------------------------------------------------------- save snapshot

  toSave(): SaveData | null {
    if (this.partyOrder.length === 0) return null;
    this.syncRosterVitals();
    const leader = this.world.getStable(`hero_${this.leaderId}`);
    const pos = leader ? leader.transform.pos : vec3(this.checkpoint.x, 0, this.checkpoint.z);
    return {
      version: 3,
      savedAt: Date.now(),
      playTimeSeconds: Math.floor(this.playTime),
      gameTime: this.gameTime,
      mapId: this.map.id,
      leader: this.leaderId,
      partyOrder: [...this.partyOrder],
      roster: JSON.parse(JSON.stringify(this.roster)) as Record<string, PartyMember>,
      position: { x: pos.x, y: pos.y, z: pos.z },
      checkpoint: { ...this.checkpoint },
      inventory: { ...this.inventory.items },
      money: this.money,
      world: JSON.parse(JSON.stringify(this.worldState)) as WorldPersistence,
      quests: JSON.parse(JSON.stringify(this.quests.state)) as SaveData['quests'],
      farm: { kills: [...this.farm.kills] },
    };
  }

  markSaving(): void {
    this.saveStatus = { status: 'saving', text: 'Guardando…' };
  }

  // ---------------------------------------------------------------- UI snapshot

  pushToast(text: string, tone: Toast['tone']): void {
    this.toasts.push({ id: this.toastSeq++, text, tone, until: this.playTime + 3.5 });
    if (this.toasts.length > 5) this.toasts.shift();
    this.notify();
  }

  subscribe = (l: () => void): (() => void) => {
    this.uiListeners.add(l);
    return () => this.uiListeners.delete(l);
  };

  getUi = (): UiSnapshot => this.ui;

  notify(): void {
    this.ui = this.buildUi();
    for (const l of this.uiListeners) l();
  }

  private buildUi(): UiSnapshot {
    const state = this.fsm.state;
    const party = this.partyOrder.map((id) => {
      const m = this.roster[id];
      const e = this.world.getStable(`hero_${id}`);
      const s = e?.combatant?.stats ?? computeStats(m);
      return {
        characterId: id,
        name: CHARACTERS[id].name,
        level: m.level,
        hp: Math.ceil(e?.combatant?.hp ?? m.hp),
        maxHp: s.maxHp,
        ki: Math.floor(e?.combatant?.ki ?? m.ki),
        maxKi: s.maxKi,
        xp: m.xp,
        xpNext: xpToNextLevel(m.level),
        ap: m.ap,
        isLeader: id === this.leaderId,
        rage: Math.floor(e?.combatant?.rage ?? m.rage),
      };
    });
    const ctl = this.controlled();
    const actor = state === 'WORLD_EXPLORATION' || state === 'RETURN_TO_WORLD' ? this.world.getStable(`hero_${this.leaderId}`) : ctl;
    const inFight = state === 'ACTIVE_COMBAT';
    const slots: UiSlot[] = [];
    const ac = actor?.combatant;
    for (let i = 0; i < 4; i++) {
      const id = ac?.slots[i] ?? null;
      const mv = id ? MOVES[id] : null;
      const t = mv?.technique;
      const blocked = actor && id && inFight ? techniqueBlocker(actor, id, this.world) : null;
      slots.push({
        index: i,
        moveId: id,
        name: mv?.name ?? '',
        kiCost: mv?.kiCost ?? 0,
        cooldown: id && ac ? Math.ceil((ac.cooldowns[id] ?? 0) * TICK_DT * 10) / 10 : 0,
        cooldownMax: mv ? mv.cooldownTicks * TICK_DT : 0,
        affordable: !!ac && !!mv && ac.ki >= mv.kiCost,
        usable: !!t && (inFight || t.usableInWorld) && !blocked,
        blocked,
        sequence: t?.sequence ?? null,
        direct: !!t && !t.sequence,
      });
    }
    const limitId = actor?.hero ? this.roster[actor.hero.characterId]?.limit : null;
    const limitMove = limitId ? MOVES[limitId] : null;
    const matching = new Set(this.focus.matching().map((c) => c.moveId + c.mode));
    const focus: UiFocus = {
      active: this.focus.active,
      remaining: this.focus.remainingSeconds,
      window: F.windowSeconds,
      input: [...this.focus.input],
      candidates: this.focus.candidates.map((c) => ({ ...c, matching: matching.has(c.moveId + c.mode) })),
      cooldown: Math.max(0, (this.focusReadyTick - this.loop.tick) * TICK_DT),
      ready: this.loop.tick >= this.focusReadyTick,
    };
    const combatants: UiCombatant[] = this.engaged().map((e) => {
      const c = e.combatant!;
      return {
        id: e.id,
        name: c.name,
        team: c.team,
        hp: Math.ceil(c.hp),
        maxHp: c.stats.maxHp,
        ki: Math.floor(c.ki),
        maxKi: c.stats.maxKi,
        state: c.state,
        isTarget: !!ctl && ctl.combatant!.targetId === e.id,
        controlled: e.id === this.controlledId,
        color: e.appearance?.palette.outfit ?? 0xffffff,
        transformed: c.transformed,
        rage: Math.floor(c.rage),
      };
    });
    let prompt: string | null = null;
    let leaderEnt: Entity | undefined;
    try {
      leaderEnt = this.partyOrder.length ? this.leader() : undefined;
    } catch {
      leaderEnt = undefined;
    }
    if (leaderEnt && state === 'WORLD_EXPLORATION' && !this.dialogue) {
      const it = this.interactTarget(leaderEnt);
      if (it) prompt = `J: ${it.interactable!.prompt}`;
    }
    const activeQuest = this.quests.activeQuests()[0];
    const ctlC = ctl?.combatant;
    const minimapEnemies = this.world.query('explorer').filter((e) => e.explorer!.state !== 'DEFEATED').map((e) => ({ x: e.transform.pos.x, z: e.transform.pos.z, boss: ENEMIES[e.explorer!.enemyId].persistentDefeat }));
    const points = this.world
      .query('interactable')
      .filter((e) => e.kind !== 'pickup' || ITEMS[this.map.pickups.find((p) => p.id === e.interactable!.refId)?.itemId ?? '']?.type === 'quest')
      .map((e) => ({ x: e.transform.pos.x, z: e.transform.pos.z, kind: e.kind }));
    return {
      version: this.uiVersion++,
      state,
      previousState: this.fsm.previous,
      cameraMode: this.camera.mode,
      party,
      slots,
      limit: limitMove && ac ? { moveId: limitMove.id, name: limitMove.name, rage: Math.floor(ac.rage), ready: limitReady(ac), sequence: limitMove.technique!.sequence! } : null,
      focus,
      status: {
        confused: ac ? ac.confusedTicks * TICK_DT : 0,
        charging: ac?.state === 'CHARGE',
        kaioken: ac?.buff ? ac.buff.ticksLeft * TICK_DT : 0,
        blinded: ac ? ac.blindTicks * TICK_DT : 0,
      },
      combatants,
      pb: { value: this.pb.value, dominance: this.pb.dominance, ticksLeft: this.pb.dominanceTicks, threshold: BALANCE.powerBalance.dominanceThreshold },
      combo: ctlC?.comboCount ?? 0,
      comboDamage: ctlC?.comboDamage ?? 0,
      prompt,
      objective: activeQuest ? this.quests.currentObjectiveText(activeQuest.def.id) : this.quests.get('valley_training').status === 'inactive' ? 'Habla con el Maestro Hoku' : null,
      money: this.money,
      area: this.map.areas.find((a) => a.id === this.currentArea)?.name ?? null,
      toasts: [...this.toasts],
      dialogue: this.dialogue ? { speaker: this.dialogue.speaker, line: this.dialogue.lines[this.dialogue.index], index: this.dialogue.index, total: this.dialogue.lines.length } : null,
      rewards: this.rewards,
      save: this.saveStatus,
      minimap: {
        w: this.map.tiles.width,
        h: this.map.tiles.height,
        player: leaderEnt ? { x: leaderEnt.transform.pos.x, z: leaderEnt.transform.pos.z, yaw: leaderEnt.transform.yaw } : { x: 0, z: 0, yaw: 0 },
        enemies: minimapEnemies,
        points,
      },
      controlledMoves: ctlC
        ? ctlC.unlockedMoves
            .map((id) => getMove(id))
            .filter((m) => m.command && m.kind !== 'special')
            .map((m) => ({ id: m.id, name: m.name, cooldown: ctlC.cooldowns[m.id] ?? 0, kiCost: m.kiCost, affordable: ctlC.ki >= m.kiCost }))
        : [],
      specialReady: !!ac && limitReady(ac),
      debug: this.settings.debug ? this.debugInfo() : null,
      playTime: Math.floor(this.playTime),
    };
  }

  private debugInfo(): UiSnapshot['debug'] {
    const lines: string[] = [];
    lines.push(`state=${this.fsm.state} cam=${this.camera.mode} PB=${this.pb.value.toFixed(1)} dom=${this.pb.dominance ?? '-'}`);
    const rs = this.renderStats;
    lines.push(
      `pantalla=${rs.screenW}x${rs.screenH} interna=${rs.internalW}x${rs.internalH} dpr=${rs.dpr.toFixed(2)} ref1080p=${rs.refScale.toFixed(2)} sprite=64x96 cámara d=${this.camera.pose.distance.toFixed(1)} fov=${this.camera.pose.fov.toFixed(0)} x${(this.timeScale).toFixed(2)}`,
    );
    const list = this.encounter ? this.engaged() : this.heroes();
    for (const e of list) {
      const c = e.combatant!;
      const p = e.transform.pos;
      const t = this.world.get(c.targetId);
      lines.push(
        `${c.name.padEnd(8)} ${c.state.padEnd(12)} hp=${Math.ceil(c.hp)} ki=${Math.floor(c.ki)} pos=(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) tgt=${t?.combatant?.name ?? '-'} ${c.playerControlled ? '[JUGADOR]' : `ai=${c.ai.action}/${c.ai.order}`}`,
      );
    }
    return { fps: Math.round(this.fps), tick: this.loop.tick, entities: this.world.entities.length, lines };
  }
}

function emptyWorld(): WorldPersistence {
  return { openedChests: [], collectedPickups: [], brokenObstacles: [], defeatedPersistent: [], enemyRespawnAt: {}, visitedAreas: [] };
}

function sprite(atlas: string, scale: number): NonNullable<Entity['sprite']> {
  return { atlas, anim: 'idle', animTicks: 0, flashTicks: 0, visible: true, alpha: 1, scale, aura: false, transformed: false };
}

export type { AppearanceDef };

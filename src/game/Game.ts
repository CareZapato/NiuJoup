import { type AiBrain, type Combatant, clearIntent, emptyIntent, type Entity } from './components';
import { BALANCE, xpToNextLevel } from './content/balance';
import { CHARACTERS, ENEMIES, NPC_APPEARANCES, STARTING_PARTY } from './content/characters';
import { ITEMS, QUESTS } from './content/items';
import { buildValley, type MapDef } from './content/maps/valley';
import { getMove } from './content/moves';
import type { AiStyle, AppearanceDef, ButtonId, EquipSlot, Stats, Team } from './content/types';
import { World } from './core/ecs/World';
import { EventBus } from './core/events/EventBus';
import { FixedLoop, TICK_DT } from './core/loop/FixedLoop';
import { clamp, damp, distXZ, lerpAngle, Rng, vec3, type Vec3, wrapAngle } from './core/math';
import { type GameState, GameStateMachine } from './core/state/GameStateMachine';
import type { GameEvents } from './events';
import { detectDoubleTap, interpretCommand, scaledConfig } from './input/CommandInterpreter';
import { BUTTON_BITS, InputBuffer, relativeDir } from './input/InputBuffer';
import { RawInput } from './input/RawInput';
import { DEFAULT_SETTINGS, type BindAction, type Settings } from './settings';
import { CombatAI } from './systems/ai/CombatAI';
import { ExplorerAI } from './systems/ai/ExplorerAI';
import { updateAnimations } from './systems/animation/AnimationSystem';
import { CameraRig, type CameraPose, makePose, screenToWorld, worldToScreen, yawForScreenRight } from './systems/camera/CameraRig';
import { type Arena, type CombatContext, CombatSystem } from './systems/combat/CombatSystem';
import { PowerBalance } from './systems/combat/PowerBalance';
import { createProjectile, ProjectileSystem } from './systems/combat/ProjectileSystem';
import { cycleTarget, isAlive } from './systems/combat/targeting';
import { followTrail, moveGroundBody, PartyTrail, tryJump } from './systems/movement/ExplorationMovement';
import type { SaveData, WorldPersistence } from './systems/persistence/saveSchema';
import type { SaveManager } from './systems/persistence/SaveManager';
import { EquipmentManager, InventoryManager, LootTableManager } from './systems/progression/inventory';
import {
  computeStats,
  createMember,
  type FarmLedger,
  farmMultiplier,
  grantXp,
  levelGapMultiplier,
  passivesOf,
  type PartyMember,
  purchaseSkill,
  recordKill,
  unlockedMoves,
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
}

export interface UiSnapshot {
  version: number;
  state: GameState;
  previousState: GameState;
  cameraMode: string;
  party: { characterId: string; name: string; level: number; hp: number; maxHp: number; ki: number; maxKi: number; xp: number; xpNext: number; ap: number; isLeader: boolean }[];
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

function makeBrain(style: AiStyle, skill: number): AiBrain {
  return { style, order: 'BALANCED', action: 'approach', actionTicks: 0, decisionCooldown: 0, scores: {}, comboStep: 0, reactionTicks: 0, circleSign: 1, skill };
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
  };
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
  private prevHeld = new Set<BindAction>();
  private pressed = new Set<BindAction>();
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
    this.projectiles = new ProjectileSystem((p) => this.projectileVsObstacles(p));
    this.ui = this.buildUi();
    this.fsm.transition('MAIN_MENU');
    this.events.on('toast', (t) => this.pushToast(t.text, t.tone ?? 'info'));
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
      const stats = computeStats(m);
      const c = makeCombatant('player', def.name, m.level, stats, unlockedMoves(m), passivesOf(m), def.aiStyle, def.meteoMoveId, def.jointPartners, 0.8);
      c.hp = m.hp;
      c.ki = m.ki;
      c.ai.order = this.allyOrders[id] ?? 'BALANCED';
      const x = px - i * 0.6;
      const z = pz + i * 0.6;
      this.world.create({
        stableId: `hero_${id}`,
        kind: 'hero',
        transform: { pos: vec3(x, map.tiles.heightAt(x, z), z), prev: vec3(x, 0, z), yaw: 0 },
        body: { vel: vec3(), radius: 0.32, height: 1.5 * def.appearance.scale, grounded: true, flying: false },
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
    this.pollGamepad();
    return this.loop.advance(dt);
  }

  private step(tick: number): void {
    this.sampleInput();
    const s = this.fsm.state;
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
    this.input.consumePulses();
    if (tick % 6 === 0) {
      this.toasts = this.toasts.filter((t) => t.until > this.playTime);
      if (this.saveStatus.status !== 'idle' && this.saveStatus.status !== 'saving' && this.playTime > this.saveStatusUntil) this.saveStatus = { status: 'idle', text: '' };
      this.notify();
    }
  }

  private sampleInput(): void {
    this.pressed.clear();
    const all: BindAction[] = ['light', 'heavy', 'ki', 'guard', 'charge', 'dash', 'up', 'down', 'special', 'camLeft', 'camRight', 'nextAlly', 'nextTarget', 'menu', 'debug'];
    for (const a of all) {
      const h = this.input.held(a);
      if (h && !this.prevHeld.has(a)) this.pressed.add(a);
      if (h) this.prevHeld.add(a);
      else this.prevHeld.delete(a);
    }
    this.input.stick(this.stick, this.settings.joystickSensitivity);
    screenToWorld(this.wdir, this.stick.x, this.stick.y, this.camera.pose.yaw);
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
    if (this.dialogue) {
      moveGroundBody(leader, this.map.tiles, 0, 0, 0);
      if (this.pressed.has('light')) this.advanceDialogue();
    } else {
      const running = this.input.held('dash');
      moveGroundBody(leader, this.map.tiles, this.wdir.x, this.wdir.z, running ? X.runSpeed : X.walkSpeed);
      if (this.pressed.has('up')) tryJump(leader);
      if (allowEncounters) {
        if (this.pressed.has('light')) this.interact();
        if (this.pressed.has('ki')) this.worldKiBlast();
        if (this.pressed.has('nextAlly')) this.cycleLeader();
      }
    }
    if (this.worldKiCooldown > 0) this.worldKiCooldown--;
    this.trail.record(leader.transform.pos.x, leader.transform.pos.z);
    const running = this.input.held('dash');
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
      case 'boulder':
        this.pushToast(
          this.leader().combatant!.passives.includes('break_obstacles') ? 'Pulsa L para lanzar una Onda de Ki contra la roca' : 'Roca agrietada. Necesitas la técnica Onda de Ki para romperla.',
          'info',
        );
        break;
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
    const strong = leader.combatant!.passives.includes('break_obstacles');
    this.worldKiCooldown = 30;
    createProjectile(this.combatCtx(0), leader, getMove(strong ? 'ki_wave' : 'ki_blast'), null, this.projectileSeq++);
  }

  private projectileVsObstacles(p: Entity): boolean {
    const pos = p.transform.pos;
    for (const b of this.world.query('interactable')) {
      if (b.kind !== 'boulder') continue;
      if (distXZ(b.transform.pos, pos) > 1.4 || pos.y > 3) continue;
      if (!p.projectile!.breaksObstacles) return true;
      const id = b.stableId;
      this.world.remove(b.id);
      this.map.tiles.clearDynamicBlocker(Math.floor(b.transform.pos.x), Math.floor(b.transform.pos.z));
      if (!this.worldState.brokenObstacles.includes(id)) this.worldState.brokenObstacles.push(id);
      this.events.emit('obstacleBroken', { id, x: b.transform.pos.x, z: b.transform.pos.z });
      this.camera.addTrauma(0.6);
      this.pushToast('¡La roca se ha hecho pedazos!', 'good');
      this.saveManager?.request('obstáculo destruido', true);
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
      c.cooldowns = {};
      c.playerControlled = e === leader;
      c.ai.decisionCooldown = 0;
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
      spawnProjectile: (owner, move, target) => createProjectile(this.combatCtx(tick), owner, move, target, this.projectileSeq++),
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
      if (this.pressed.has('nextAlly')) this.cycleControlled();
      const c2 = this.controlled();
      if (c2) this.playerCombatIntent(c2, tick);
    } else if (ctl) {
      clearIntent(ctl.combatant!.intent);
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
      if (this.pb.dominance === 'player') this.pushToast('¡DOMINIO! Pulsa F para un Meteo Attack', 'good');
      else if (this.pb.dominance === 'enemy') this.pushToast('¡El enemigo domina el combate! Defiéndete (U)', 'warn');
    }
    if (this.pb.dominance === 'player') {
      // Teammates with the meteo-mastery passive extend the window.
      this.pb.windowBonusTicks = this.heroes().some((h) => h.combatant!.passives.includes('meteo_plus')) ? 120 : 0;
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
    i.moveX = this.wdir.x;
    i.moveZ = this.wdir.z;
    i.moveY = (this.input.held('up') ? 1 : 0) - (this.input.held('down') ? 1 : 0);
    i.guard = this.input.held('guard');
    i.charge = this.input.held('charge');
    i.special = this.pressed.has('special');
    if (this.pressed.has('nextTarget')) {
      const t = cycleTarget(e, this.engaged());
      if (t) c.targetId = t.id;
    }
    let held = 0;
    for (const b of BUTTONS) if (this.input.held(b)) held |= BUTTON_BITS[b];
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
    if (c.passives.includes('teleport') && detectDoubleTap(this.buffer, this.interpreterCfg)) i.teleport = true;
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
      e.body!.flying = false;
    }
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
        m.hp = s.maxHp;
        m.ki = s.maxKi;
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
    for (const h of this.heroes()) {
      const m = this.roster[h.hero!.characterId];
      const c = h.combatant!;
      c.stats = computeStats(m);
      c.level = m.level;
      c.unlockedMoves = unlockedMoves(m);
      c.passives = passivesOf(m);
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
    out.focus.y = l.transform.pos.y + 0.6;
    out.focus.z = l.transform.pos.z;
    out.yaw = 0;
    out.pitch = 1.02;
    out.distance = 15;
    out.fov = 40;
    return out;
  }

  /** Attract-mode orbit over the village behind the main menu. */
  private menuPose(out: CameraPose, tick: number): CameraPose {
    out.focus.x = 22;
    out.focus.y = 0;
    out.focus.z = 16;
    out.yaw = this.settings.reducedMotion ? 0.4 : tick * 0.0015;
    out.pitch = 0.62;
    out.distance = 24;
    out.fov = 45;
    return out;
  }

  private combatPose(out: CameraPose): CameraPose {
    const ctl = this.controlled() ?? this.leader();
    const target = this.world.get(ctl.combatant!.targetId);
    const p = ctl.transform.pos;
    let fx = p.x;
    let fy = p.y;
    let fz = p.z;
    if (target && isAlive(target)) {
      fx = p.x * 0.6 + target.transform.pos.x * 0.4;
      fy = p.y * 0.6 + target.transform.pos.y * 0.4;
      fz = p.z * 0.6 + target.transform.pos.z * 0.4;
    }
    let spread = 0;
    for (const e of this.engaged()) {
      if (e.combatant!.state === 'DEFEATED') continue;
      spread = Math.max(spread, Math.hypot(e.transform.pos.x - fx, e.transform.pos.z - fz));
    }
    const camRot = (this.input.held('camRight') ? 1 : 0) - (this.input.held('camLeft') ? 1 : 0);
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
    out.focus.x = fx;
    out.focus.y = fy + 0.7;
    out.focus.z = fz;
    out.yaw = this.combatYaw;
    out.pitch = 0.34;
    out.distance = clamp(6.5 + spread * 0.85, 7, 17);
    out.fov = 50;
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
    out.pitch = 0.18;
    out.distance = 5;
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
        if (s === 'COMBAT_VICTORY') this.desiredCam.distance += this.fsm.stateTicks * 0.02;
      }
    } else {
      this.explorationPose(this.desiredCam);
    }
    this.camera.update(this.desiredCam, TICK_DT);
  }

  // ---------------------------------------------------------------- pause / UI actions

  pause(): void {
    if (!this.fsm.canTransition('PAUSED') || this.fsm.state === 'PAUSED') return;
    this.fsm.transition('PAUSED');
    this.input.releaseAll();
    this.notify();
  }

  resume(): void {
    if (this.fsm.state !== 'PAUSED') return;
    this.fsm.resume();
    this.input.releaseAll();
    this.prevHeld.clear();
    this.prevHeld.add('menu');
    this.loop.reset();
    this.notify();
  }

  /** App went to background: pause and flush a save while the OS allows it. */
  suspend(): void {
    this.pause();
    if (this.fsm.previous === 'WORLD_EXPLORATION' || this.fsm.state === 'WORLD_EXPLORATION') this.saveManager?.request('suspensión', true);
  }

  purchaseSkill(characterId: string, skillId: string): string | null {
    const m = this.roster[characterId];
    const r = purchaseSkill(m, skillId);
    if (!r.ok) return r.reason;
    this.refreshHeroCombatants();
    this.handleQuestUpdates(this.quests.onSkillUnlocked());
    this.pushToast(`${CHARACTERS[characterId].name} aprende una técnica`, 'good');
    this.saveManager?.request('habilidad comprada', true);
    this.notify();
    return null;
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
      const stats = computeStats(m);
      const c = makeCombatant('player', def.name, m.level, stats, unlockedMoves(m), passivesOf(m), def.aiStyle, def.meteoMoveId, def.jointPartners, 0.8);
      c.hp = m.hp;
      c.ki = m.ki;
      this.world.create({
        stableId: `hero_${id}`,
        kind: 'hero',
        transform: { pos: vec3(leader.x - i * 0.5, leader.y, leader.z + i * 0.5), prev: vec3(leader.x, leader.y, leader.z), yaw: 0 },
        body: { vel: vec3(), radius: 0.32, height: 1.5 * def.appearance.scale, grounded: true, flying: false },
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
    }
  }

  // ---------------------------------------------------------------- debug

  debugAddPower(amount: number): void {
    this.pb.add('player', amount);
    if (this.pb.dominance) this.events.emit('dominance', { team: this.pb.dominance });
    this.notify();
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
      version: 2,
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
      };
    });
    const ctl = this.controlled();
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
      specialReady: this.pb.dominance === 'player',
      debug: this.settings.debug ? this.debugInfo() : null,
      playTime: Math.floor(this.playTime),
    };
  }

  private debugInfo(): UiSnapshot['debug'] {
    const lines: string[] = [];
    lines.push(`state=${this.fsm.state} cam=${this.camera.mode} PB=${this.pb.value.toFixed(1)} dom=${this.pb.dominance ?? '-'}`);
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

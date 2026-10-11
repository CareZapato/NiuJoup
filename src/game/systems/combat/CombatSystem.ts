import type { CombatStateId, Entity } from '../../components';
import { BALANCE } from '../../content/balance';
import { ENEMIES } from '../../content/characters';
import { getMove, MOVES, moveTotalTicks } from '../../content/moves';
import type { MoveDef, TechniqueDef } from '../../content/types';
import type { World } from '../../core/ecs/World';
import type { EventBus } from '../../core/events/EventBus';
import { TICK_DT } from '../../core/loop/FixedLoop';
import { clamp, damp, distXZ, lerpAngle, type Rng, vec3, type Vec3, yawFromDir } from '../../core/math';
import type { GameEvents } from '../../events';
import { resolveChain } from '../../input/CommandInterpreter';
import type { TileMap } from '../../world/TileMap';
import { hitboxCenter, sphereHitsCapsule } from '../collision/shapes';
import { computeDamage } from './damage';
import { canAfford, chargeKi, regenKi, spendKi } from './ki';
import type { PowerBalance } from './PowerBalance';
import { limitReady, rageFromDamage, rageFromHitLanded } from './rage';
import { clipLine, distribute, isAlive, isHostile, nearestEnemy, selectTargets } from './targeting';

export interface Arena {
  center: Vec3;
  radius: number;
}

export interface ProjectileOpts {
  castId: number;
  /** Damage multiplier (mastery, buffs) baked into the projectile. */
  power?: number;
  /** Launch direction override (unit XZ). */
  dirX?: number;
  dirZ?: number;
  /** Spawn height offset above the default (discs form over the head). */
  lift?: number;
  impacts?: number;
  rehitTicks?: number;
  retarget?: boolean;
  bossImpactCap?: number;
}

export interface CombatContext {
  world: World;
  map: TileMap;
  pb: PowerBalance;
  events: EventBus<GameEvents>;
  rng: Rng;
  tick: number;
  arena: Arena;
  spawnProjectile: (owner: Entity, move: MoveDef, target: Entity | null, opts?: ProjectileOpts) => void;
  nextCastId: () => number;
}

export interface HitOpts {
  /** Extra damage multiplier (mastery). */
  multiplier?: number;
  /** Max fraction of a boss's max HP this impact may remove. */
  bossImpactCap?: number;
  /** Intermediate impact of a multi-hit rush (light reaction). */
  minor?: boolean;
}

const C = BALANCE.combat;
const F = BALANCE.focus;
const scratch = vec3();

const ATTACK_STATES: ReadonlySet<CombatStateId> = new Set(['LIGHT_ATTACK', 'HEAVY_ATTACK', 'KI_ATTACK', 'SPECIAL_ATTACK']);
const STUNNED: ReadonlySet<CombatStateId> = new Set(['HIT_STUN', 'KNOCKBACK', 'LAUNCHED']);
const FREE: ReadonlySet<CombatStateId> = new Set(['IDLE', 'MOVE', 'FLY']);

export const isAttacking = (s: CombatStateId): boolean => ATTACK_STATES.has(s);
export const isStunned = (s: CombatStateId): boolean => STUNNED.has(s);
export const isFree = (s: CombatStateId): boolean => FREE.has(s);

function setState(e: Entity, s: CombatStateId): void {
  const c = e.combatant!;
  c.state = s;
  c.stateTicks = 0;
  if (!isAttacking(s)) c.moveId = null;
}

function stateForMove(m: MoveDef): CombatStateId {
  switch (m.kind) {
    case 'light':
      return 'LIGHT_ATTACK';
    case 'ki':
      return 'KI_ATTACK';
    case 'special':
      return 'SPECIAL_ATTACK';
    default:
      return 'HEAVY_ATTACK';
  }
}

export const isBoss = (e: Entity): boolean => !!e.explorer && !!ENEMIES[e.explorer.enemyId]?.persistentDefeat;

function buffDef(e: Entity): TechniqueDef['buff'] | null {
  const b = e.combatant!.buff;
  return b ? (getMove(b.moveId).technique?.buff ?? null) : null;
}

export function speedMultiplier(e: Entity): number {
  const c = e.combatant!;
  return (0.8 + c.stats.speed / 50) * (c.transformed ? 1.2 : 1) * (buffDef(e)?.speedMultiplier ?? 1);
}

export function attackMultiplier(e: Entity): number {
  const c = e.combatant!;
  return (c.transformed ? 1.2 : 1) * (buffDef(e)?.attackMultiplier ?? 1);
}

export const masteryMultiplier = (c: { mastery: Record<string, number> }, moveId: string): number => 1 + 0.12 * (c.mastery[moveId] ?? 0);
export const masteryCooldown = (c: { mastery: Record<string, number> }, m: MoveDef): number => Math.round(m.cooldownTicks * (1 - 0.1 * (c.mastery[m.id] ?? 0)));

/** Can this combatant start a new action right now (not stunned, confused, mid-move...)? */
export function canAct(c: { state: CombatStateId; confusedTicks: number; blindTicks: number; meteoVictim: boolean }): boolean {
  return isFree(c.state) && c.confusedTicks <= 0 && c.blindTicks <= 0 && !c.meteoVictim;
}

/**
 * Validation shared by the focus controller (at sequence start) and the
 * combat system (at execution). Returns null when usable, else a reason.
 */
export function techniqueBlocker(e: Entity, moveId: string, world: World): string | null {
  const c = e.combatant!;
  const m = MOVES[moveId];
  const t = m?.technique;
  if (!m || !t) return 'Técnica desconocida';
  if (t.slot === 'limit') {
    if (!limitReady(c)) return 'Furia insuficiente';
  } else {
    if (!c.unlockedMoves.includes(moveId)) return 'Técnica bloqueada';
    if ((c.cooldowns[moveId] ?? 0) > 0) return 'En recarga';
    if (!canAfford(c, m.kiCost)) return 'Ki insuficiente';
  }
  if (t.effect === 'teleport') {
    const target = world.get(c.targetId);
    if (!isHostile(e, target) || distXZ(target.transform.pos, e.transform.pos) > t.targeting.range) return 'Sin objetivo al alcance';
  }
  if (t.effect === 'buff' && c.buff) return 'Ya activo';
  return null;
}

/**
 * Real-time combat for every engaged combatant simultaneously. Player input
 * and AI both arrive as Intents, so allies, enemies and the player share the
 * exact same rules, frame data and costs.
 */
export class CombatSystem {
  update(ctx: CombatContext, combatants: readonly Entity[]): void {
    for (const e of combatants) {
      const c = e.combatant!;
      if (!c.engaged) continue;
      if (c.hitstop > 0) {
        c.hitstop--;
        continue;
      }
      this.tickTimers(e, ctx);
      if (c.state === 'DEFEATED') {
        this.fallDefeated(e, ctx);
        continue;
      }
      if (c.meteoVictim) continue;
      if (!isHostile(e, ctx.world.get(c.targetId))) {
        const t = nearestEnemy(e, combatants);
        c.targetId = t ? t.id : -1;
      }
      if (c.intent.nextTarget) c.intent.nextTarget = false;
      if (c.intent.action) {
        c.bufferedAction = c.intent.action;
        c.bufferedTicks = 10;
      }
      if (c.meteo) this.updateMeteo(e, ctx);
      else this.updateState(e, ctx);
      this.integrate(e, ctx);
      c.stateTicks++;
    }
    this.separate(combatants);
  }

  private tickTimers(e: Entity, ctx: CombatContext): void {
    const c = e.combatant!;
    if (c.invuln > 0) c.invuln--;
    if (c.bufferedTicks > 0 && --c.bufferedTicks === 0) c.bufferedAction = null;
    for (const k in c.cooldowns) if (c.cooldowns[k] > 0) c.cooldowns[k]--;
    if (c.comboTimer > 0 && --c.comboTimer === 0) {
      if (c.comboCount >= 3) ctx.events.emit('comboFinish', { attackerId: e.id, count: c.comboCount });
      c.comboCount = 0;
      c.comboDamage = 0;
    }
    if (c.confusedTicks > 0) c.confusedTicks--;
    if (c.blindTicks > 0) c.blindTicks--;
    if (c.state !== 'CHARGE' && c.state !== 'DEFEATED') regenKi(c);
    if (c.buff) this.tickBuff(e);
    c.transformed = c.passives.includes('transform') && ctx.pb.dominance === c.team;
    if (e.sprite) e.sprite.transformed = c.transformed;
  }

  /** Kaioken-style sustained cost. HP strain never kills and never feeds rage. */
  private tickBuff(e: Entity): void {
    const c = e.combatant!;
    const b = c.buff!;
    const def = buffDef(e)!;
    c.ki = Math.max(0, c.ki - def.kiDrainPerSecond * TICK_DT);
    c.hp = Math.max(1, c.hp - def.hpDrainPerSecond * TICK_DT);
    if (--b.ticksLeft <= 0 || c.ki <= 0 || c.state === 'DEFEATED') {
      c.buff = null;
      if (e.sprite) {
        e.sprite.auraColor = null;
        e.sprite.strain = false;
      }
    }
  }

  private target(e: Entity, ctx: CombatContext): Entity | null {
    const t = ctx.world.get(e.combatant!.targetId);
    return t && isAlive(t) ? t : null;
  }

  private faceTarget(e: Entity, ctx: CombatContext, sharp = 18): void {
    const t = this.target(e, ctx);
    if (!t) return;
    const yaw = yawFromDir(t.transform.pos.x - e.transform.pos.x, t.transform.pos.z - e.transform.pos.z);
    e.transform.yaw = lerpAngle(e.transform.yaw, yaw, damp(sharp, TICK_DT));
  }

  private updateState(e: Entity, ctx: CombatContext): void {
    const c = e.combatant!;
    const body = e.body!;
    const intent = c.intent;
    // Stun-lock breaker: after a long uninterrupted chain of hit reactions (typically 3-on-1),
    // the victim gets a short window where hits still hurt but no longer stun.
    if (c.stunArmorTicks > 0) c.stunArmorTicks--;
    if (isStunned(c.state) && !c.meteoVictim) {
      if (++c.stunChain >= C.stunLockMaxTicks) {
        c.stunChain = 0;
        c.stunArmorTicks = C.stunLockArmorTicks;
        c.hitstun = Math.min(c.hitstun, 4);
      }
    } else if (c.stunChain > 0) {
      // Decays instead of resetting, so one-tick gaps between hits don't hide a lock.
      c.stunChain = Math.max(0, c.stunChain - C.stunLockDecayPerTick);
    }
    switch (c.state) {
      case 'HIT_STUN':
        this.applyFriction(body, 8);
        if (--c.hitstun <= 0) setState(e, 'IDLE');
        return;
      case 'KNOCKBACK':
        this.applyFriction(body, C.knockbackFriction);
        if (--c.hitstun <= 0) setState(e, 'RECOVERY');
        return;
      case 'LAUNCHED':
        body.vel.y -= C.launchGravity * TICK_DT;
        this.applyFriction(body, 1.5, true);
        if (--c.hitstun <= 0) setState(e, 'RECOVERY');
        return;
      case 'RECOVERY':
        this.applyFriction(body, 10);
        body.vel.y *= 0.85;
        if (c.stateTicks >= C.recoveryTicks) {
          c.invuln = C.invulnAfterRecovery;
          setState(e, 'IDLE');
        }
        return;
      case 'PARRY':
        this.applyFriction(body, 12);
        if (c.stateTicks > 14) setState(e, 'IDLE');
        return;
      case 'CONFUSED':
        // Unbalanced: no attack, guard or dodge; buffered input is discarded.
        this.applyFriction(body, 10);
        c.bufferedAction = null;
        if (c.confusedTicks <= 0) setState(e, 'IDLE');
        return;
      case 'BLINDED':
        this.applyFriction(body, 10);
        c.bufferedAction = null;
        if (c.blindTicks <= 0) setState(e, 'IDLE');
        return;
      case 'DASH':
        this.updateDash(e, ctx);
        return;
      case 'GUARD':
        this.applyFriction(body, 14);
        this.faceTarget(e, ctx);
        if (!intent.guard) setState(e, 'IDLE');
        return;
      case 'CHARGE':
        // Immobile; attacks and guard are blocked until the charge is released.
        this.applyFriction(body, 14);
        c.bufferedAction = null;
        chargeKi(c);
        if (!intent.charge || c.ki >= c.stats.maxKi) setState(e, 'IDLE');
        return;
      case 'LIGHT_ATTACK':
      case 'HEAVY_ATTACK':
      case 'KI_ATTACK':
      case 'SPECIAL_ATTACK':
        this.updateAttack(e, ctx);
        return;
      default:
        this.updateFree(e, ctx);
    }
  }

  /** IDLE / MOVE / FLY: process new commands then movement. */
  private updateFree(e: Entity, ctx: CombatContext): void {
    const c = e.combatant!;
    const body = e.body!;
    const intent = c.intent;

    if (c.confusedTicks > 0) {
      setState(e, 'CONFUSED');
      return;
    }
    if (c.blindTicks > 0) {
      setState(e, 'BLINDED');
      return;
    }
    if (intent.special && this.tryStartMeteo(e, ctx)) return;
    if (intent.technique && this.tryStartTechnique(e, intent.technique, ctx)) return;
    if (c.bufferedAction && this.tryStartMove(e, c.bufferedAction, ctx)) {
      c.bufferedAction = null;
      return;
    }
    if (intent.dash && this.tryDash(e, ctx)) return;
    if (intent.guard) {
      setState(e, 'GUARD');
      c.guardStartTick = ctx.tick;
      return;
    }
    if (intent.charge && c.ki < c.stats.maxKi) {
      setState(e, 'CHARGE');
      return;
    }

    const sp = (body.flying ? C.flySpeed : C.groundSpeed) * speedMultiplier(e);
    const k = damp(14, TICK_DT);
    body.vel.x += (intent.moveX * sp - body.vel.x) * k;
    body.vel.z += (intent.moveZ * sp - body.vel.z) * k;
    body.vel.y += (intent.moveY * C.verticalSpeed - body.vel.y) * k;
    const moving = Math.abs(intent.moveX) + Math.abs(intent.moveZ) + Math.abs(intent.moveY) > 0.1;
    const next: CombatStateId = moving ? (body.flying ? 'FLY' : 'MOVE') : 'IDLE';
    if (c.state !== next) {
      c.state = next;
      c.stateTicks = 0;
    }
    if (this.target(e, ctx)) this.faceTarget(e, ctx, 12);
    else if (moving) e.transform.yaw = lerpAngle(e.transform.yaw, yawFromDir(body.vel.x, body.vel.z), damp(12, TICK_DT));
  }

  tryStartMove(e: Entity, requested: string, ctx: CombatContext): boolean {
    const c = e.combatant!;
    const id = resolveChain(isAttacking(c.state) ? c.moveId : null, requested);
    const m = MOVES[id];
    if (!m || m.technique) return false;
    if (!c.unlockedMoves.includes(id)) return false;
    if ((c.cooldowns[id] ?? 0) > 0) return false;
    if (id === 'air_chase') {
      const t = ctx.world.get(c.lastLaunchedTarget);
      if (!t || t.combatant?.state !== 'LAUNCHED' || ctx.tick - c.lastLaunchTick > 120) return false;
      c.targetId = t.id;
    }
    if (!spendKi(c, m.kiCost)) return false;
    this.beginMove(e, m, ctx);
    if (id === 'air_chase') {
      const t = this.target(e, ctx);
      if (t) {
        // Appear just beside the launched target (short teleport-style chase).
        const from = e.transform.pos;
        ctx.events.emit('teleport', { entityId: e.id, fromX: from.x, fromY: from.y, fromZ: from.z });
        const yaw = yawFromDir(t.transform.pos.x - from.x, t.transform.pos.z - from.z);
        from.x = t.transform.pos.x - Math.sin(yaw) * 1.1;
        from.z = t.transform.pos.z - Math.cos(yaw) * 1.1;
        from.y = t.transform.pos.y + 0.6;
        e.transform.yaw = yaw;
      }
    }
    return true;
  }

  private beginMove(e: Entity, m: MoveDef, ctx: CombatContext): void {
    const c = e.combatant!;
    c.moveId = m.id;
    c.moveTick = 0;
    c.moveHits.length = 0;
    c.moveConnected = false;
    c.castEmitted = 0;
    c.castHits = {};
    c.castId = ctx.nextCastId();
    c.state = stateForMove(m);
    c.stateTicks = 0;
    const cd = masteryCooldown(c, m);
    if (cd > 0) c.cooldowns[m.id] = cd;
    this.faceTarget(e, ctx, 60);
  }

  /**
   * Named techniques. A player-controlled fighter needs the matching
   * sequence token, so offensive specials can't skip their sequence. Ki (or
   * all rage, for limits) is charged exactly once, here, at execution.
   */
  tryStartTechnique(e: Entity, id: string, ctx: CombatContext): boolean {
    const c = e.combatant!;
    const m = MOVES[id];
    const t = m?.technique;
    if (!m || !t || !canAct(c)) return false;
    if (c.playerControlled && c.sequenceToken !== id) return false;
    if (techniqueBlocker(e, id, ctx.world)) return false;
    if (t.slot === 'limit') c.rage = 0;
    else if (!spendKi(c, m.kiCost)) return false;
    c.sequenceToken = null;
    this.beginMove(e, m, ctx);
    ctx.events.emit('techniqueUsed', { entityId: e.id, moveId: id, name: m.name, limit: t.slot === 'limit' });
    return true;
  }

  private updateAttack(e: Entity, ctx: CombatContext): void {
    const c = e.combatant!;
    const body = e.body!;
    const m = getMove(c.moveId!);
    const t = c.moveTick;
    const target = this.target(e, ctx);

    // Cancel window into a chained/cancellable move.
    if (!m.technique && c.bufferedAction && t >= m.cancelFrom && (c.moveConnected || !m.cancelOnHitOnly)) {
      const next = resolveChain(c.moveId, c.bufferedAction);
      if (m.cancelInto.includes(next) && this.tryStartMove(e, c.bufferedAction, ctx)) {
        c.bufferedAction = null;
        return;
      }
    }

    if (t < m.startup + m.active) {
      if (t < m.startup) this.faceTarget(e, ctx, 25);
      if (m.lunge > 0 && !m.projectile && t >= (m.technique ? m.startup : 0)) {
        const fx = Math.sin(e.transform.yaw);
        const fz = Math.cos(e.transform.yaw);
        let speed = m.lunge;
        if (target) {
          if (m.technique) this.faceTarget(e, ctx, 30);
          const d = Math.hypot(target.transform.pos.x - e.transform.pos.x, target.transform.pos.z - e.transform.pos.z);
          const stopAt = (m.hitbox.forward + target.body!.radius) * 0.85;
          if (d <= stopAt) speed = 0;
          const dy = target.transform.pos.y - e.transform.pos.y;
          body.vel.y = clamp(dy * 8, -C.verticalSpeed * 1.6, C.verticalSpeed * 1.6);
        }
        body.vel.x = fx * speed;
        body.vel.z = fz * speed;
      } else {
        this.applyFriction(body, 14);
        body.vel.y *= 0.8;
      }
    } else {
      this.applyFriction(body, 12);
      body.vel.y *= 0.8;
    }

    if (m.technique) this.updateTechnique(e, m, m.technique, ctx, target);
    else {
      if (t === m.startup && m.projectile) ctx.spawnProjectile(e, m, target, { castId: c.castId, power: attackMultiplier(e) });
      if (!m.projectile && t >= m.startup && t < m.startup + m.active) {
        hitboxCenter(scratch, e.transform.pos, e.transform.yaw, body.height, e.sprite?.scale ?? 1, m.hitbox);
        const r = m.hitbox.radius * (e.sprite?.scale ?? 1);
        for (const o of ctx.world.query('combatant')) {
          if (!isHostile(e, o) || c.moveHits.includes(o.id)) continue;
          if (sphereHitsCapsule(scratch.x, scratch.y, scratch.z, r, o.transform.pos, o.body!.height, o.body!.radius)) {
            c.moveHits.push(o.id);
            this.applyHit(e, o, m, Math.sin(e.transform.yaw), Math.cos(e.transform.yaw), ctx);
          }
        }
      }
    }

    c.moveTick++;
    if (c.moveTick >= moveTotalTicks(m)) setState(e, 'IDLE');
  }

  private updateTechnique(e: Entity, m: MoveDef, tech: TechniqueDef, ctx: CombatContext, target: Entity | null): void {
    const c = e.combatant!;
    const t = c.moveTick;
    const mult = masteryMultiplier(c, m.id);
    const yaw = e.transform.yaw;
    const dirX = Math.sin(yaw);
    const dirZ = Math.cos(yaw);
    const origin = vec3(e.transform.pos.x + dirX * 0.5, e.transform.pos.y + e.body!.height * 0.55, e.transform.pos.z + dirZ * 0.5);
    const all = ctx.world.query('combatant');
    const query = { origin, dirX, dirZ, targeting: tech.targeting, preferId: c.targetId };
    switch (tech.effect) {
      case 'beam': {
        if (t !== m.startup) return;
        const length = clipLine(ctx.map, origin.x, origin.z, origin.y, dirX, dirZ, tech.targeting.range);
        const hits = selectTargets(e, all, { ...query, length }, ctx.map).slice(0, tech.targeting.maxImpacts);
        ctx.events.emit('beamFired', { ownerId: e.id, x: origin.x, y: origin.y, z: origin.z, dirX, dirZ, length, width: tech.targeting.width, ticks: m.active, color: e.appearance?.palette.aura ?? 0x9ad8ff });
        for (const o of hits) this.applyHit(e, o, m, dirX, dirZ, ctx, { multiplier: mult * attackMultiplier(e), bossImpactCap: tech.targeting.bossImpactCap });
        return;
      }
      case 'disc':
      case 'guided':
      case 'scatter':
      case 'barrage': {
        const count = tech.count ?? 1;
        const interval = tech.interval ?? 1;
        if (t < m.startup || c.castEmitted >= count || (t - m.startup) % interval !== 0) return;
        if (c.castEmitted === 0) c.castHits = {};
        const targets = selectTargets(e, all, query, ctx.map);
        const plan = distribute(targets, count, c.castMode);
        const tgt = plan[c.castEmitted] ?? target;
        const spread = tech.effect === 'scatter' ? (c.castEmitted - (count - 1) / 2) * 0.35 : 0;
        const perProjectileImpacts = tech.effect === 'disc' ? Math.max(1, Math.floor(tech.targeting.maxImpacts / count)) : tech.effect === 'guided' ? tech.targeting.maxImpacts : 1;
        ctx.spawnProjectile(e, m, tgt, {
          castId: c.castId,
          power: mult * attackMultiplier(e),
          dirX: Math.sin(yaw + spread),
          dirZ: Math.cos(yaw + spread),
          lift: tech.pose === 'kienzan' ? e.body!.height * 0.55 : tech.effect === 'scatter' ? 0.8 : 0,
          impacts: perProjectileImpacts,
          rehitTicks: tech.targeting.rehitTicks,
          retarget: tech.targeting.onTargetDeath === 'retarget',
          bossImpactCap: tech.targeting.bossImpactCap,
        });
        c.castEmitted++;
        return;
      }
      case 'flash': {
        if (t !== m.startup) return;
        const hits = selectTargets(e, all, { ...query, origin: e.transform.pos }, ctx.map).slice(0, tech.targeting.maxImpacts);
        for (const o of hits) {
          const oc = o.combatant!;
          if (oc.meteoVictim) continue;
          oc.blindTicks = isBoss(o) ? (tech.bossBlindTicks ?? 60) : (tech.blindTicks ?? 120);
          oc.moveId = null;
          oc.bufferedAction = null;
          setState(o, 'BLINDED');
          ctx.events.emit('blinded', { entityId: o.id, ticks: oc.blindTicks });
        }
        ctx.pb.add(c.team, m.powerBalance);
        ctx.events.emit('flash', { ownerId: e.id, x: e.transform.pos.x, y: e.transform.pos.y + 1.2, z: e.transform.pos.z, radius: tech.targeting.width, affected: hits.length });
        return;
      }
      case 'rush': {
        if (t < m.startup || t >= m.startup + m.active) return;
        const maxImpacts = tech.targeting.maxImpacts;
        if (c.castEmitted >= maxImpacts) return;
        hitboxCenter(scratch, e.transform.pos, yaw, e.body!.height, e.sprite?.scale ?? 1, m.hitbox);
        const r = m.hitbox.radius * (e.sprite?.scale ?? 1);
        let landed = 0;
        for (const o of all) {
          if (!isHostile(e, o) || landed >= tech.targeting.maxTargets) continue;
          const last = c.castHits[o.id];
          if (last !== undefined && (tech.targeting.rehitTicks <= 0 || t - last < tech.targeting.rehitTicks)) continue;
          if (!sphereHitsCapsule(scratch.x, scratch.y, scratch.z, r, o.transform.pos, o.body!.height, o.body!.radius)) continue;
          c.castHits[o.id] = t;
          c.castEmitted++;
          landed++;
          const final = c.castEmitted >= maxImpacts;
          this.applyHit(e, o, m, dirX, dirZ, ctx, { multiplier: mult * attackMultiplier(e), minor: !final });
          // Hold the victim in place during the flurry.
          if (!final && o.combatant!.state !== 'DEFEATED') o.combatant!.hitstun = Math.max(o.combatant!.hitstun, tech.targeting.rehitTicks + 4);
        }
        return;
      }
      case 'buff': {
        if (t !== m.startup || !tech.buff) return;
        c.buff = { moveId: m.id, ticksLeft: tech.buff.durationTicks };
        if (e.sprite) {
          e.sprite.auraColor = 0xff3a2a;
          e.sprite.strain = true;
        }
        return;
      }
      case 'teleport': {
        if (t !== m.startup) return;
        const tg = target && distXZ(target.transform.pos, e.transform.pos) <= tech.targeting.range ? target : null;
        if (!tg) return;
        const from = e.transform.pos;
        ctx.events.emit('teleport', { entityId: e.id, fromX: from.x, fromY: from.y, fromZ: from.z });
        const away = yawFromDir(tg.transform.pos.x - from.x, tg.transform.pos.z - from.z);
        let nx = tg.transform.pos.x + Math.sin(away) * 1.2;
        let nz = tg.transform.pos.z + Math.cos(away) * 1.2;
        if (!ctx.map.canOccupy(nx, nz, tg.transform.pos.y, e.body!.radius, 0.05, true)) {
          nx = tg.transform.pos.x - Math.sin(away) * 1.2;
          nz = tg.transform.pos.z - Math.cos(away) * 1.2;
        }
        from.x = e.transform.prev.x = nx;
        from.z = e.transform.prev.z = nz;
        from.y = e.transform.prev.y = tg.transform.pos.y;
        e.transform.yaw = yawFromDir(tg.transform.pos.x - nx, tg.transform.pos.z - nz);
        return;
      }
    }
  }

  applyHit(attacker: Entity, defender: Entity, m: MoveDef, dirX: number, dirZ: number, ctx: CombatContext, opts: HitOpts = {}): void {
    const a = attacker.combatant!;
    const d = defender.combatant!;
    if (!isHostile(attacker, defender)) return;
    if (d.invuln > 0 || d.meteoVictim) return;
    a.moveConnected = true;
    const px = defender.transform.pos.x;
    const py = defender.transform.pos.y + defender.body!.height * 0.6;
    const pz = defender.transform.pos.z;

    const guarding = d.state === 'GUARD' && this.facing(defender, attacker);
    if (guarding && ctx.tick - d.guardStartTick <= C.parryWindowTicks && m.kind !== 'special') {
      setState(defender, 'PARRY');
      if (!m.projectile) {
        setState(attacker, 'HIT_STUN');
        a.hitstun = C.parryStunTicks;
        attacker.body!.vel.x = dirX * -4;
        attacker.body!.vel.z = dirZ * -4;
      }
      ctx.pb.gain(d.team, 'parry');
      ctx.events.emit('parry', { attackerId: attacker.id, defenderId: defender.id, x: px, y: py, z: pz });
      if (d.passives.includes('counter') && !m.projectile) {
        d.bufferedAction = 'heavy';
        d.bufferedTicks = 20;
      }
      a.hitstop = d.hitstop = 8;
      return;
    }

    const comboBefore = isStunned(d.state) ? a.comboCount : 0;
    const confusedMult = d.confusedTicks > 0 ? F.confusedDamageTaken : 1;
    const res = computeDamage(m, a.stats, d.stats, {
      comboCount: comboBefore,
      guarding,
      critRoll: ctx.rng.next(),
      attackerMultiplier: opts.multiplier ?? attackMultiplier(attacker),
      bonusMultiplier: confusedMult,
    });
    let damage = res.damage;
    if (opts.bossImpactCap !== undefined && isBoss(defender)) damage = Math.min(damage, Math.max(1, Math.floor(d.stats.maxHp * opts.bossImpactCap)));
    d.hp = Math.max(0, d.hp - damage);
    d.lastHitBy = attacker.id;
    d.lastHitTick = ctx.tick;
    if (rageFromDamage(d, a, damage, guarding)) ctx.events.emit('limitReady', { entityId: defender.id, characterId: defender.hero?.characterId ?? '' });

    if (guarding) {
      d.ki = Math.max(0, d.ki - C.guardKiDrainPerHit);
      defender.body!.vel.x = dirX * m.knockback * 0.35;
      defender.body!.vel.z = dirZ * m.knockback * 0.35;
      a.hitstop = d.hitstop = 4;
      ctx.events.emit('hit', { attackerId: attacker.id, defenderId: defender.id, x: px, y: py, z: pz, damage, crit: false, blocked: true, heavy: false, moveId: m.id });
    } else {
      a.comboCount = comboBefore + 1;
      a.comboTimer = C.comboResetTicks;
      a.comboDamage += damage;
      // A limit's own impacts never refill the rage it just consumed.
      if (m.technique?.slot !== 'limit' && rageFromHitLanded(a, d)) ctx.events.emit('limitReady', { entityId: attacker.id, characterId: attacker.hero?.characterId ?? '' });
      const body = defender.body!;
      const armored = d.stunArmorTicks > 0 && d.state !== 'DEFEATED';
      // Interrupt whatever the defender was doing (charging, focusing, attacking).
      if (!armored) {
        d.moveId = null;
        d.chargeHeld = 0;
      }
      const causes = opts.minor ? 'hitstun' : m.causes;
      const kb = opts.minor ? 0.6 : m.knockback;
      if (armored) {
        body.vel.x += dirX * kb * 0.2;
        body.vel.z += dirZ * kb * 0.2;
      } else if (causes === 'launch') {
        setState(defender, 'LAUNCHED');
        body.vel.x = dirX * kb;
        body.vel.z = dirZ * kb;
        body.vel.y = m.lift;
        a.lastLaunchedTarget = defender.id;
        a.lastLaunchTick = ctx.tick;
      } else if (causes === 'knockback') {
        setState(defender, 'KNOCKBACK');
        body.vel.x = dirX * kb;
        body.vel.z = dirZ * kb;
        body.vel.y = m.lift;
        ctx.pb.gain(a.team, 'knockdown');
      } else {
        setState(defender, 'HIT_STUN');
        body.vel.x = dirX * kb;
        body.vel.z = dirZ * kb;
      }
      if (!armored) d.hitstun = m.hitstun;
      const heavy = !opts.minor && m.kind !== 'light' && !(m.kind === 'ki' && m.damage < 10);
      a.hitstop = d.hitstop = heavy ? 6 : 3;
      if (defender.sprite) defender.sprite.flashTicks = 6;

      ctx.pb.add(a.team, opts.minor ? m.powerBalance * 0.25 : m.powerBalance);
      if (m.finisher && a.comboCount >= 3) ctx.pb.gain(a.team, 'comboFinisherBonus');
      this.registerCoordination(attacker, defender, ctx);
      ctx.events.emit('hit', { attackerId: attacker.id, defenderId: defender.id, x: px, y: py, z: pz, damage, crit: res.crit, blocked: false, heavy, moveId: m.id });
    }

    if (d.hp <= 0) {
      setState(defender, 'DEFEATED');
      d.buff = null;
      d.confusedTicks = 0;
      d.blindTicks = 0;
      defender.body!.vel.x = dirX * 6;
      defender.body!.vel.z = dirZ * 6;
      defender.body!.vel.y = 3;
      defender.body!.flying = false;
      ctx.events.emit('defeated', { entityId: defender.id, killerId: attacker.id });
    }
  }

  /** Records which ally last struck a target so coordinated bonuses can be awarded. */
  private coordinationLedger = new Map<number, { by: number; tick: number }>();

  registerCoordination(attacker: Entity, defender: Entity, ctx: CombatContext): void {
    const prev = this.coordinationLedger.get(defender.id);
    if (prev && prev.by !== attacker.id && ctx.tick - prev.tick <= C.coordinatedWindowTicks) {
      const partner = ctx.world.get(prev.by);
      if (partner?.combatant?.team === attacker.combatant!.team) {
        ctx.pb.gain(attacker.combatant!.team, 'coordinatedAttack');
        ctx.events.emit('coordinated', { attackerId: attacker.id, partnerId: partner.id });
        this.coordinationLedger.delete(defender.id);
        return;
      }
    }
    this.coordinationLedger.set(defender.id, { by: attacker.id, tick: ctx.tick });
  }

  private facing(defender: Entity, attacker: Entity): boolean {
    const yaw = yawFromDir(attacker.transform.pos.x - defender.transform.pos.x, attacker.transform.pos.z - defender.transform.pos.z);
    const diff = Math.abs(((yaw - defender.transform.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    return diff < (Math.PI * 100) / 180;
  }

  private tryDash(e: Entity, ctx: CombatContext): boolean {
    const c = e.combatant!;
    if (!spendKi(c, BALANCE.ki.costs.dash)) return false;
    const i = c.intent;
    let dx = i.moveX;
    let dz = i.moveZ;
    let dy = i.moveY * 0.6;
    if (Math.hypot(dx, dz, dy) < 0.1) {
      const t = this.target(e, ctx);
      if (t) {
        dx = t.transform.pos.x - e.transform.pos.x;
        dz = t.transform.pos.z - e.transform.pos.z;
        dy = (t.transform.pos.y - e.transform.pos.y) * 0.5;
      } else {
        dx = Math.sin(e.transform.yaw);
        dz = Math.cos(e.transform.yaw);
      }
    }
    const len = Math.hypot(dx, dz, dy) || 1;
    c.dashDir.x = dx / len;
    c.dashDir.y = dy / len;
    c.dashDir.z = dz / len;
    c.dashTicks = C.dashTicks;
    setState(e, 'DASH');
    ctx.events.emit('dash', { entityId: e.id });
    return true;
  }

  private updateDash(e: Entity, ctx: CombatContext): void {
    const c = e.combatant!;
    const body = e.body!;
    if (c.bufferedAction && c.stateTicks > 3 && this.tryStartMove(e, c.bufferedAction, ctx)) {
      c.bufferedAction = null;
      return;
    }
    const sp = C.dashSpeed * speedMultiplier(e);
    body.vel.x = c.dashDir.x * sp;
    body.vel.y = c.dashDir.y * sp;
    body.vel.z = c.dashDir.z * sp;
    // Stop short of the target instead of passing through it.
    const t = this.target(e, ctx);
    if (t) {
      const d = Math.hypot(t.transform.pos.x - e.transform.pos.x, t.transform.pos.z - e.transform.pos.z);
      const toward = c.dashDir.x * (t.transform.pos.x - e.transform.pos.x) + c.dashDir.z * (t.transform.pos.z - e.transform.pos.z) > 0;
      if (toward && d < 1.2) c.dashTicks = 0;
    }
    if (--c.dashTicks <= 0) {
      body.vel.x *= 0.3;
      body.vel.y *= 0.3;
      body.vel.z *= 0.3;
      setState(e, 'IDLE');
    }
  }

  private tryStartMeteo(e: Entity, ctx: CombatContext): boolean {
    const c = e.combatant!;
    const t = this.target(e, ctx);
    if (!t || !ctx.pb.canMeteo(c.team)) return false;
    if (t.combatant!.meteoVictim) return false;
    ctx.pb.consume(c.team);
    c.meteo = { targetId: t.id, partnerId: -1, tick: 0, damageDealt: false, defended: false };
    setState(e, 'SPECIAL_ATTACK');
    c.moveId = c.meteoMoveId;
    t.combatant!.meteoVictim = true;
    t.combatant!.moveId = null;
    setState(t, 'HIT_STUN');
    t.combatant!.hitstun = C.meteoTicks;
    ctx.events.emit('meteoStart', { attackerId: e.id, victimId: t.id, partnerId: -1, team: c.team });
    return true;
  }

  private updateMeteo(e: Entity, ctx: CombatContext): void {
    const c = e.combatant!;
    const ms = c.meteo!;
    const victim = ctx.world.get(ms.targetId);
    const body = e.body!;
    if (!victim || !victim.combatant) {
      c.meteo = null;
      setState(e, 'IDLE');
      return;
    }
    const v = victim.combatant;
    const vp = victim.transform.pos;
    const p = e.transform.pos;
    const k = ms.tick;
    body.vel.x = body.vel.y = body.vel.z = 0;
    victim.body!.vel.x = victim.body!.vel.z = 0;
    victim.body!.vel.y = 0;

    if (k < 18) {
      // Rush in.
      const yaw = yawFromDir(vp.x - p.x, vp.z - p.z);
      const tx = vp.x - Math.sin(yaw) * 0.95;
      const tz = vp.z - Math.cos(yaw) * 0.95;
      const f = damp(14, TICK_DT);
      p.x += (tx - p.x) * f;
      p.z += (tz - p.z) * f;
      p.y += (vp.y - p.y) * f;
      e.transform.yaw = yaw;
      if (k === 16) {
        // Defensive reaction: players by holding guard, AI by technique roll.
        const tech = v.stats.technique;
        ms.defended = v.playerControlled ? v.intent.guard : ctx.rng.chance(clamp(0.1 + tech / 100, 0, 0.5) * v.ai.skill);
      }
    } else if (k < 82) {
      if ((k - 18) % 8 === 0) {
        const side = ((k - 18) / 8) % 2 === 0 ? 1 : -1;
        e.transform.yaw += side * 0.4;
        vp.y += 0.08;
        if (victim.sprite) victim.sprite.flashTicks = 4;
        ctx.events.emit('meteoHit', { x: vp.x, y: vp.y + 0.8, z: vp.z, final: false });
      }
    } else if (k === 82) {
      const move = getMove(c.meteoMoveId);
      const mult = C.meteoDamageMultiplier;
      const res = computeDamage(move, c.stats, v.stats, { comboCount: 0, guarding: false, critRoll: 1, attackerMultiplier: attackMultiplier(e), bonusMultiplier: mult * (ms.defended ? C.meteoDefendReduction : 1) });
      v.hp = Math.max(0, v.hp - res.damage);
      if (rageFromDamage(v, c, res.damage, ms.defended)) ctx.events.emit('limitReady', { entityId: victim.id, characterId: victim.hero?.characterId ?? '' });
      ms.damageDealt = true;
      const yaw = e.transform.yaw;
      victim.body!.vel.x = Math.sin(yaw) * move.knockback;
      victim.body!.vel.z = Math.cos(yaw) * move.knockback;
      victim.body!.vel.y = move.lift;
      v.meteoVictim = false;
      setState(victim, 'KNOCKBACK');
      v.hitstun = 40;
      ctx.events.emit('meteoHit', { x: vp.x, y: vp.y + 0.8, z: vp.z, final: true });
      ctx.events.emit('hit', { attackerId: e.id, defenderId: victim.id, x: vp.x, y: vp.y + 0.8, z: vp.z, damage: res.damage, crit: true, blocked: ms.defended, heavy: true, moveId: move.id });
      ctx.events.emit('meteoEnd', { attackerId: e.id, victimId: victim.id, damage: res.damage, defended: ms.defended });
      if (v.hp <= 0) {
        setState(victim, 'DEFEATED');
        victim.body!.flying = false;
        ctx.events.emit('defeated', { entityId: victim.id, killerId: e.id });
      }
    } else if (k > 100) {
      c.meteo = null;
      setState(e, 'IDLE');
      return;
    }
    ms.tick++;
  }

  private applyFriction(body: { vel: Vec3 }, sharp: number, horizontalOnly = false): void {
    const f = 1 - damp(sharp, TICK_DT);
    body.vel.x *= f;
    body.vel.z *= f;
    if (!horizontalOnly) body.vel.y *= f;
  }

  private fallDefeated(e: Entity, ctx: CombatContext): void {
    const body = e.body!;
    body.vel.y -= BALANCE.exploration.gravity * TICK_DT;
    this.applyFriction(body, 3, true);
    this.integrate(e, ctx);
  }

  /** Moves the body, colliding with terrain in 3D and keeping fighters inside the arena. */
  private integrate(e: Entity, ctx: CombatContext): void {
    const body = e.body!;
    const p = e.transform.pos;
    const dt = TICK_DT;
    const nx = p.x + body.vel.x * dt;
    const nz = p.z + body.vel.z * dt;
    if (ctx.map.canOccupy(nx, p.z, p.y, body.radius, 0.05, true)) p.x = nx;
    else body.vel.x = 0;
    if (ctx.map.canOccupy(p.x, nz, p.y, body.radius, 0.05, true)) p.z = nz;
    else body.vel.z = 0;
    p.y += body.vel.y * dt;

    const ground = ctx.map.heightAt(p.x, p.z);
    if (p.y < ground) {
      p.y = ground;
      if (body.vel.y < 0) body.vel.y = 0;
    }
    if (p.y > ground + C.arenaMaxHeight) {
      p.y = ground + C.arenaMaxHeight;
      if (body.vel.y > 0) body.vel.y = 0;
    }
    body.grounded = p.y <= ground + 0.01;

    const a = ctx.arena;
    const dx = p.x - a.center.x;
    const dz = p.z - a.center.z;
    const d = Math.hypot(dx, dz);
    if (d > a.radius) {
      p.x = a.center.x + (dx / d) * a.radius;
      p.z = a.center.z + (dz / d) * a.radius;
    }
  }

  /** Soft push-apart so fighters never stack on top of each other. */
  private separate(list: readonly Entity[]): void {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.combatant!.engaged || a.combatant!.state === 'DEFEATED' || a.combatant!.meteo || a.combatant!.meteoVictim) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.combatant!.engaged || b.combatant!.state === 'DEFEATED' || b.combatant!.meteo || b.combatant!.meteoVictim) continue;
        const dx = b.transform.pos.x - a.transform.pos.x;
        const dz = b.transform.pos.z - a.transform.pos.z;
        const dy = b.transform.pos.y - a.transform.pos.y;
        const min = (a.body!.radius + b.body!.radius) * 1.15;
        if (Math.abs(dy) > 1.2) continue;
        const d = Math.hypot(dx, dz);
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) * 0.5;
        const ux = dx / d;
        const uz = dz / d;
        a.transform.pos.x -= ux * push;
        a.transform.pos.z -= uz * push;
        b.transform.pos.x += ux * push;
        b.transform.pos.z += uz * push;
      }
    }
  }
}

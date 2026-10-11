import type { CombatStateId, Entity } from '../../components';
import { BALANCE } from '../../content/balance';
import { getMove, MOVES, moveTotalTicks } from '../../content/moves';
import type { MoveDef } from '../../content/types';
import type { World } from '../../core/ecs/World';
import type { EventBus } from '../../core/events/EventBus';
import { TICK_DT } from '../../core/loop/FixedLoop';
import { clamp, damp, lerpAngle, type Rng, vec3, type Vec3, yawFromDir } from '../../core/math';
import type { GameEvents } from '../../events';
import { resolveChain } from '../../input/CommandInterpreter';
import type { TileMap } from '../../world/TileMap';
import { hitboxCenter, sphereHitsCapsule } from '../collision/shapes';
import { computeDamage, spendKi } from './damage';
import type { PowerBalance } from './PowerBalance';
import { isAlive, isValidTarget, nearestEnemy } from './targeting';

export interface Arena {
  center: Vec3;
  radius: number;
}

export interface CombatContext {
  world: World;
  map: TileMap;
  pb: PowerBalance;
  events: EventBus<GameEvents>;
  rng: Rng;
  tick: number;
  arena: Arena;
  spawnProjectile: (owner: Entity, move: MoveDef, target: Entity | null) => void;
}

const C = BALANCE.combat;
const scratch = vec3();

const ATTACK_STATES: ReadonlySet<CombatStateId> = new Set(['LIGHT_ATTACK', 'HEAVY_ATTACK', 'KI_ATTACK', 'SPECIAL_ATTACK']);
const STUNNED: ReadonlySet<CombatStateId> = new Set(['HIT_STUN', 'KNOCKBACK', 'LAUNCHED']);

export const isAttacking = (s: CombatStateId): boolean => ATTACK_STATES.has(s);
export const isStunned = (s: CombatStateId): boolean => STUNNED.has(s);

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

export function speedMultiplier(e: Entity): number {
  const c = e.combatant!;
  return (0.8 + c.stats.speed / 50) * (c.transformed ? 1.2 : 1);
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
      if (!isValidTarget(e, ctx.world.get(c.targetId))) {
        const t = nearestEnemy(e, combatants);
        c.targetId = t ? t.id : -1;
      }
      if (c.intent.nextTarget) {
        // Handled by the caller (needs player context); cleared here.
        c.intent.nextTarget = false;
      }
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
    if (c.state !== 'CHARGE' && c.state !== 'DEFEATED') c.ki = Math.min(c.stats.maxKi, c.ki + C.kiRegenPerSecond * TICK_DT);
    c.transformed = c.passives.includes('transform') && ctx.pb.dominance === c.team;
    if (e.sprite) e.sprite.transformed = c.transformed;
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
    switch (c.state) {
      case 'HIT_STUN':
        this.applyFriction(body, 8);
        if (--c.hitstun <= 0) setState(e, 'IDLE');
        return;
      case 'KNOCKBACK':
        this.applyFriction(body, C.knockbackFriction);
        if (--c.hitstun <= 0) {
          setState(e, 'RECOVERY');
        }
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
      case 'DASH':
        this.updateDash(e, ctx);
        return;
      case 'GUARD':
        this.applyFriction(body, 14);
        this.faceTarget(e, ctx);
        if (!intent.guard) setState(e, 'IDLE');
        return;
      case 'CHARGE':
        this.applyFriction(body, 14);
        c.ki = Math.min(c.stats.maxKi, c.ki + C.kiChargePerSecond * TICK_DT);
        if (!intent.charge) setState(e, 'IDLE');
        else if (c.bufferedAction || intent.guard || intent.dash) setState(e, 'IDLE');
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

    if (intent.special && this.tryStartMeteo(e, ctx)) return;
    if (c.bufferedAction && this.tryStartMove(e, c.bufferedAction, ctx)) {
      c.bufferedAction = null;
      return;
    }
    if (intent.teleport && c.passives.includes('teleport') && this.tryTeleport(e, ctx)) return;
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
    if (!c.unlockedMoves.includes(id)) return false;
    const m = MOVES[id];
    if (!m) return false;
    if ((c.cooldowns[id] ?? 0) > 0) return false;
    if (id === 'air_chase') {
      const t = ctx.world.get(c.lastLaunchedTarget);
      if (!t || t.combatant?.state !== 'LAUNCHED' || ctx.tick - c.lastLaunchTick > 120) return false;
      c.targetId = t.id;
    }
    if (!spendKi(c, m.kiCost)) return false;
    c.moveId = id;
    c.moveTick = 0;
    c.moveHits.length = 0;
    c.moveConnected = false;
    c.state = stateForMove(m);
    c.stateTicks = 0;
    if (m.cooldownTicks > 0) c.cooldowns[id] = m.cooldownTicks;
    this.faceTarget(e, ctx, 60);
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

  private updateAttack(e: Entity, ctx: CombatContext): void {
    const c = e.combatant!;
    const body = e.body!;
    const m = getMove(c.moveId!);
    const t = c.moveTick;
    const target = this.target(e, ctx);

    // Cancel window into a chained/cancellable move.
    if (c.bufferedAction && t >= m.cancelFrom && (c.moveConnected || !m.cancelOnHitOnly)) {
      const next = resolveChain(c.moveId, c.bufferedAction);
      if (m.cancelInto.includes(next) && this.tryStartMove(e, c.bufferedAction, ctx)) {
        c.bufferedAction = null;
        return;
      }
    }

    if (t < m.startup + m.active) {
      if (t < m.startup) this.faceTarget(e, ctx, 25);
      if (m.lunge > 0 && !m.projectile) {
        const fx = Math.sin(e.transform.yaw);
        const fz = Math.cos(e.transform.yaw);
        let speed = m.lunge;
        if (target) {
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

    if (t === m.startup && m.projectile) ctx.spawnProjectile(e, m, target);

    if (!m.projectile && t >= m.startup && t < m.startup + m.active) {
      hitboxCenter(scratch, e.transform.pos, e.transform.yaw, body.height, e.sprite?.scale ?? 1, m.hitbox);
      const r = m.hitbox.radius * (e.sprite?.scale ?? 1);
      for (const o of ctx.world.query('combatant')) {
        if (o === e || !isAlive(o) || o.combatant!.team === c.team) continue;
        if (c.moveHits.includes(o.id)) continue;
        if (sphereHitsCapsule(scratch.x, scratch.y, scratch.z, r, o.transform.pos, o.body!.height, o.body!.radius)) {
          c.moveHits.push(o.id);
          this.applyHit(e, o, m, Math.sin(e.transform.yaw), Math.cos(e.transform.yaw), ctx);
        }
      }
    }

    c.moveTick++;
    if (c.moveTick >= moveTotalTicks(m)) setState(e, 'IDLE');
  }

  applyHit(attacker: Entity, defender: Entity, m: MoveDef, dirX: number, dirZ: number, ctx: CombatContext): void {
    const a = attacker.combatant!;
    const d = defender.combatant!;
    if (d.invuln > 0 || d.meteoVictim || d.state === 'DEFEATED') return;
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
    const res = computeDamage(m, a.stats, d.stats, {
      comboCount: comboBefore,
      guarding,
      critRoll: ctx.rng.next(),
      attackerMultiplier: a.transformed ? 1.2 : 1,
    });
    d.hp = Math.max(0, d.hp - res.damage);
    d.lastHitBy = attacker.id;
    d.lastHitTick = ctx.tick;

    if (guarding) {
      d.ki = Math.max(0, d.ki - C.guardKiDrainPerHit);
      defender.body!.vel.x = dirX * m.knockback * 0.35;
      defender.body!.vel.z = dirZ * m.knockback * 0.35;
      a.hitstop = d.hitstop = 4;
      ctx.events.emit('hit', { attackerId: attacker.id, defenderId: defender.id, x: px, y: py, z: pz, damage: res.damage, crit: false, blocked: true, heavy: false, moveId: m.id });
    } else {
      a.comboCount = comboBefore + 1;
      a.comboTimer = C.comboResetTicks;
      a.comboDamage += res.damage;
      // Interrupt whatever the defender was doing.
      d.moveId = null;
      d.chargeHeld = 0;
      const body = defender.body!;
      if (m.causes === 'launch') {
        setState(defender, 'LAUNCHED');
        body.vel.x = dirX * m.knockback;
        body.vel.z = dirZ * m.knockback;
        body.vel.y = m.lift;
        a.lastLaunchedTarget = defender.id;
        a.lastLaunchTick = ctx.tick;
      } else if (m.causes === 'knockback') {
        setState(defender, 'KNOCKBACK');
        body.vel.x = dirX * m.knockback;
        body.vel.z = dirZ * m.knockback;
        body.vel.y = m.lift;
        ctx.pb.gain(a.team, 'knockdown');
      } else {
        setState(defender, 'HIT_STUN');
        body.vel.x = dirX * m.knockback;
        body.vel.z = dirZ * m.knockback;
      }
      d.hitstun = m.hitstun;
      const heavy = m.kind !== 'light' && !(m.kind === 'ki' && m.damage < 10);
      a.hitstop = d.hitstop = heavy ? 6 : 3;
      if (defender.sprite) defender.sprite.flashTicks = 6;

      ctx.pb.add(a.team, m.powerBalance);
      if (m.finisher && a.comboCount >= 3) ctx.pb.gain(a.team, 'comboFinisherBonus');
      this.registerCoordination(attacker, defender, ctx);
      ctx.events.emit('hit', { attackerId: attacker.id, defenderId: defender.id, x: px, y: py, z: pz, damage: res.damage, crit: res.crit, blocked: false, heavy, moveId: m.id });
    }

    if (d.hp <= 0) {
      setState(defender, 'DEFEATED');
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
    if (!spendKi(c, C.dashKiCost)) return false;
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

  private tryTeleport(e: Entity, ctx: CombatContext): boolean {
    const c = e.combatant!;
    if (!spendKi(c, C.teleportKiCost)) return false;
    const i = c.intent;
    const len = Math.hypot(i.moveX, i.moveZ) || 1;
    const from = e.transform.pos;
    ctx.events.emit('teleport', { entityId: e.id, fromX: from.x, fromY: from.y, fromZ: from.z });
    from.x += (i.moveX / len) * C.teleportDistance;
    from.z += (i.moveZ / len) * C.teleportDistance;
    e.transform.prev.x = from.x;
    e.transform.prev.z = from.z;
    c.invuln = 12;
    return true;
  }

  private tryStartMeteo(e: Entity, ctx: CombatContext): boolean {
    const c = e.combatant!;
    const t = this.target(e, ctx);
    if (!t || !ctx.pb.canMeteo(c.team)) return false;
    if (t.combatant!.meteoVictim) return false;
    ctx.pb.consume(c.team);
    let partnerId = -1;
    if (c.passives.includes('joint')) {
      for (const o of ctx.world.query('combatant', 'hero')) {
        if (o !== e && isAlive(o) && o.combatant!.team === c.team && c.jointPartners.includes(o.hero!.characterId)) {
          partnerId = o.id;
          break;
        }
      }
    }
    c.meteo = { targetId: t.id, partnerId, tick: 0, damageDealt: false, defended: false };
    setState(e, 'SPECIAL_ATTACK');
    c.moveId = c.meteoMoveId;
    t.combatant!.meteoVictim = true;
    t.combatant!.moveId = null;
    setState(t, 'HIT_STUN');
    t.combatant!.hitstun = C.meteoTicks;
    ctx.events.emit('meteoStart', { attackerId: e.id, victimId: t.id, partnerId, team: c.team });
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
      const mult = C.meteoDamageMultiplier * (c.passives.includes('meteo_plus') ? 1.25 : 1) * (ms.partnerId >= 0 ? 1.4 : 1);
      const res = computeDamage(move, c.stats, v.stats, { comboCount: 0, guarding: false, critRoll: 1, attackerMultiplier: c.transformed ? 1.2 : 1, bonusMultiplier: mult * (ms.defended ? C.meteoDefendReduction : 1) });
      v.hp = Math.max(0, v.hp - res.damage);
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

import { type AiAction, clearIntent, type Entity } from '../../components';
import { BALANCE } from '../../content/balance';
import { getMove } from '../../content/moves';
import type { AiStyle } from '../../content/types';
import { clamp, dist3, type Rng } from '../../core/math';
import type { World } from '../../core/ecs/World';
import { isAttacking, isStunned } from '../combat/CombatSystem';
import type { PowerBalance } from '../combat/PowerBalance';
import { attackersOn, isAlive, isValidTarget } from '../combat/targeting';

/**
 * Utility AI. Each decision scores every action from continuous considerations
 * (distance, HP, Ki, threats, team state, orders, personality) and picks the
 * best with hysteresis. Chosen over Behavior Trees because combat priorities
 * are fuzzy and overlapping, and over a pure FSM because tuning lives in data
 * (weights) rather than transition graphs. The low-level physical FSM lives in
 * CombatSystem; the AI only emits Intents, exactly like the player.
 */

interface StyleWeights {
  aggression: number;
  zoning: number;
  defense: number;
  agility: number;
}

const STYLES: Record<AiStyle, StyleWeights> = {
  balanced: { aggression: 1, zoning: 1, defense: 1, agility: 1 },
  rushdown: { aggression: 1.3, zoning: 0.6, defense: 0.8, agility: 1.3 },
  zoner: { aggression: 0.7, zoning: 1.6, defense: 1, agility: 1 },
  tank: { aggression: 1, zoning: 0.6, defense: 1.5, agility: 0.6 },
  brute: { aggression: 1.35, zoning: 0.8, defense: 0.5, agility: 0.5 },
};

export interface AiContext {
  world: World;
  pb: PowerBalance;
  rng: Rng;
  tick: number;
  /** The player's current target, for FOCUS_TARGET orders. */
  leaderTargetId: number;
}

function threatLevel(self: Entity, all: readonly Entity[], world: World, reaction: number): number {
  let threat = 0;
  for (const o of all) {
    if (!isValidTarget(self, o)) continue;
    const c = o.combatant!;
    if (c.targetId !== self.id || !isAttacking(c.state) || !c.moveId) continue;
    const m = getMove(c.moveId);
    if (c.moveTick < reaction || c.moveTick > m.startup + 1) continue;
    const d = dist3(o.transform.pos, self.transform.pos);
    if (!m.projectile && d < 2.6) threat = Math.max(threat, 1);
    if (m.projectile && d < 9) threat = Math.max(threat, 0.6);
  }
  for (const p of world.query('projectile')) {
    const pr = p.projectile!;
    if (pr.team === self.combatant!.team || pr.targetId !== self.id) continue;
    if (dist3(p.transform.pos, self.transform.pos) < 4.5) threat = Math.max(threat, 0.8);
  }
  return threat;
}

function chooseTarget(self: Entity, all: readonly Entity[], ctx: AiContext): void {
  const c = self.combatant!;
  if (c.ai.order === 'FOCUS_TARGET' && c.team === 'player') {
    const t = ctx.world.get(ctx.leaderTargetId);
    if (isValidTarget(self, t)) {
      c.targetId = t.id;
      return;
    }
  }
  let best: Entity | null = null;
  let bestScore = -Infinity;
  for (const o of all) {
    if (!isValidTarget(self, o)) continue;
    const oc = o.combatant!;
    let s = -dist3(self.transform.pos, o.transform.pos) * 0.15;
    s += (1 - oc.hp / oc.stats.maxHp) * 0.6;
    s -= attackersOn(o, self, all) * 0.55;
    if (o.id === c.targetId) s += 0.35;
    // Coordination: an ally launched this enemy -> pile on.
    if (oc.state === 'LAUNCHED') s += 0.9;
    // Support: punish enemies attacking a wounded ally.
    const victim = ctx.world.get(oc.targetId);
    if (victim && victim.combatant && victim.combatant.team === c.team && victim.combatant.hp / victim.combatant.stats.maxHp < 0.4) {
      s += c.ai.order === 'SUPPORT' ? 1.2 : 0.6;
    }
    if (s > bestScore) {
      bestScore = s;
      best = o;
    }
  }
  c.targetId = best ? best.id : -1;
}

export class CombatAI {
  update(all: readonly Entity[], ctx: AiContext): void {
    for (const e of all) {
      const c = e.combatant!;
      if (!c.engaged || c.playerControlled || c.state === 'DEFEATED' || c.meteoVictim || c.meteo) continue;
      this.think(e, all, ctx);
    }
  }

  private think(e: Entity, all: readonly Entity[], ctx: AiContext): void {
    const c = e.combatant!;
    const brain = c.ai;
    clearIntent(c.intent);
    brain.actionTicks++;

    if (--brain.decisionCooldown <= 0) {
      chooseTarget(e, all, ctx);
      this.decide(e, all, ctx);
      brain.decisionCooldown = Math.round(10 + (1 - brain.skill) * 14 + ctx.rng.next() * 6);
    }
    const target = ctx.world.get(c.targetId);
    if (!target || !isAlive(target)) {
      this.wander(e);
      return;
    }
    this.execute(e, target, all, ctx);
  }

  private decide(e: Entity, all: readonly Entity[], ctx: AiContext): void {
    const c = e.combatant!;
    const brain = c.ai;
    const w = STYLES[brain.style];
    const target = ctx.world.get(c.targetId);
    const scores = brain.scores;
    for (const k in scores) delete scores[k as AiAction];
    if (!target || !isAlive(target)) {
      brain.action = 'circle';
      return;
    }
    const tc = target.combatant!;
    const d = dist3(e.transform.pos, target.transform.pos);
    const hp = c.hp / c.stats.maxHp;
    const ki = c.ki / c.stats.maxKi;
    const reaction = Math.round(2 + (1 - brain.skill) * 8);
    const threat = threatLevel(e, all, ctx.world, reaction);
    const ord = brain.order;
    const aggr = w.aggression * (ord === 'AGGRESSIVE' ? 1.4 : ord === 'DEFENSIVE' ? 0.7 : ord === 'SUPPORT' ? 0.8 : 1);
    const defense = w.defense * (ord === 'DEFENSIVE' ? 1.5 : ord === 'AGGRESSIVE' ? 0.6 : 1);
    const zoning = w.zoning * (ord === 'SUPPORT' ? 1.4 : 1);
    const canKi = c.ki >= 8;

    scores.attack = (d < 1.8 ? 1 : 0) * aggr + (isStunned(tc.state) && d < 2.2 ? 0.45 : 0);
    scores.approach = d > 1.6 ? clamp((d - 1.6) / 4, 0.2, 1) * 0.75 * aggr : 0;
    scores.kiBlast = canKi && d > 2.8 && d < 11 ? 0.55 * zoning : 0;
    scores.charge = d > 5 && ki < 0.35 ? 0.75 : ki < 0.2 ? 0.45 : 0.05;
    scores.guard = threat > 0 ? 0.9 * threat * defense * (0.4 + brain.skill) : 0;
    scores.evade = threat > 0.5 && c.ki >= BALANCE.combat.dashKiCost ? 0.6 * w.agility * brain.skill : 0;
    scores.retreat = (hp < 0.3 ? 0.6 * (2 - aggr) * 0.5 : 0) + (brain.style === 'zoner' && d < 2.5 ? 0.55 : 0);
    scores.circle = d < 4.5 && attackersOn(target, e, all) >= 1 ? 0.45 : 0.15;
    scores.special = ctx.pb.canMeteo(c.team) ? 1.6 : 0;
    const canChase = c.unlockedMoves.includes('air_chase') || c.unlockedMoves.includes('rush');
    scores.chase = tc.state === 'LAUNCHED' && canChase && c.ki >= 6 ? 1.15 : d > 7 && c.ki > 20 ? 0.5 * w.agility : 0;

    // Leave room for the player: when the controlled hero is already in melee with this
    // target, allies (except on AGGRESSIVE) support from range instead of stealing the fight.
    if (c.team === 'player' && ord !== 'AGGRESSIVE' && tc.state !== 'LAUNCHED') {
      const leaderOnIt = all.some((o) => o !== e && o.combatant!.playerControlled && o.combatant!.targetId === target.id && dist3(o.transform.pos, target.transform.pos) < 3.5);
      if (leaderOnIt) {
        scores.attack *= 0.35;
        scores.approach *= 0.5;
        scores.circle = (scores.circle ?? 0) + 0.3;
      }
    }

    // Finished a combo string recently: breathe instead of pressing forever.
    if (brain.action === 'attack' && brain.comboStep >= 3) {
      scores.attack = 0;
      scores.circle = (scores.circle ?? 0) + 0.5;
    }

    let best: AiAction = 'circle';
    let bestScore = -Infinity;
    for (const k of Object.keys(scores) as AiAction[]) {
      const jitter = ctx.rng.next() * 0.12;
      const s = (scores[k] ?? 0) + jitter + (k === brain.action ? 0.15 : 0);
      if (s > bestScore) {
        bestScore = s;
        best = k;
      }
    }
    if (best !== brain.action) {
      brain.action = best;
      brain.actionTicks = 0;
      if (best === 'attack') brain.comboStep = 0;
      if (best === 'circle') brain.circleSign = ctx.rng.chance(0.5) ? 1 : -1;
    }
  }

  private moveToward(e: Entity, tx: number, ty: number, tz: number, speed = 1): void {
    const i = e.combatant!.intent;
    const dx = tx - e.transform.pos.x;
    const dz = tz - e.transform.pos.z;
    const l = Math.hypot(dx, dz);
    if (l > 0.05) {
      i.moveX = (dx / l) * speed;
      i.moveZ = (dz / l) * speed;
    }
    const dy = ty - e.transform.pos.y;
    i.moveY = Math.abs(dy) > 0.25 ? clamp(dy, -1, 1) : 0;
  }

  private execute(e: Entity, target: Entity, all: readonly Entity[], ctx: AiContext): void {
    const c = e.combatant!;
    const brain = c.ai;
    const i = c.intent;
    const tp = target.transform.pos;
    const p = e.transform.pos;
    const d = dist3(p, tp);
    const free = c.state === 'IDLE' || c.state === 'MOVE' || c.state === 'FLY';

    switch (brain.action) {
      case 'approach':
        this.moveToward(e, tp.x, tp.y, tp.z);
        if (d > 7 && free && c.ki > 25 && ctx.rng.chance(0.03)) i.dash = true;
        if (d < 1.7) brain.decisionCooldown = 0;
        break;
      case 'attack': {
        if (d > 1.7) {
          this.moveToward(e, tp.x, tp.y, tp.z);
          break;
        }
        this.moveToward(e, tp.x, tp.y, tp.z, 0.2);
        const canChain = free || (isAttacking(c.state) && c.moveConnected);
        if (canChain && brain.actionTicks % 7 === 0 && brain.comboStep < 3) {
          const step = brain.comboStep;
          if (step < 2) i.action = 'light_1';
          else if (c.unlockedMoves.includes('launcher') && ctx.rng.chance(0.35)) i.action = 'launcher';
          else if (c.unlockedMoves.includes('meteor_impact') && c.ki > 30 && ctx.rng.chance(0.3)) i.action = 'meteor_impact';
          else i.action = 'heavy';
          brain.comboStep++;
        }
        if (brain.comboStep >= 3 && free) brain.decisionCooldown = Math.min(brain.decisionCooldown, 4);
        break;
      }
      case 'kiBlast': {
        const perp = brain.circleSign;
        const dx = tp.x - p.x;
        const dz = tp.z - p.z;
        const l = Math.hypot(dx, dz) || 1;
        i.moveX = (-dz / l) * perp * 0.6;
        i.moveZ = (dx / l) * perp * 0.6;
        if (free && brain.actionTicks % 16 === 1) {
          if (c.unlockedMoves.includes('ki_wave') && c.ki > 45 && (c.cooldowns.ki_wave ?? 0) === 0 && ctx.rng.chance(0.3)) i.action = 'ki_wave';
          else if (c.unlockedMoves.includes('ki_barrage') && c.ki > 30 && ctx.rng.chance(0.4)) i.action = 'ki_barrage';
          else i.action = 'ki_blast';
        }
        if (brain.actionTicks > 50) brain.decisionCooldown = 0;
        break;
      }
      case 'charge':
        i.charge = true;
        if (c.ki >= c.stats.maxKi * 0.85) brain.decisionCooldown = 0;
        break;
      case 'guard':
        i.guard = true;
        if (brain.actionTicks > 28) brain.decisionCooldown = 0;
        break;
      case 'evade': {
        if (brain.actionTicks === 1 && free) {
          const dx = tp.x - p.x;
          const dz = tp.z - p.z;
          const l = Math.hypot(dx, dz) || 1;
          i.moveX = (-dz / l) * brain.circleSign;
          i.moveZ = (dx / l) * brain.circleSign;
          i.moveY = ctx.rng.chance(0.4) ? 0.8 : 0;
          i.dash = true;
        }
        if (brain.actionTicks > 16) brain.decisionCooldown = 0;
        break;
      }
      case 'retreat': {
        const dx = p.x - tp.x;
        const dz = p.z - tp.z;
        const l = Math.hypot(dx, dz) || 1;
        i.moveX = dx / l;
        i.moveZ = dz / l;
        i.moveY = p.y < tp.y + 2 ? 0.6 : 0;
        if (brain.actionTicks > 40) brain.decisionCooldown = 0;
        break;
      }
      case 'circle': {
        const dx = tp.x - p.x;
        const dz = tp.z - p.z;
        const l = Math.hypot(dx, dz) || 1;
        const keep = l < 2.2 ? -0.5 : l > 3.5 ? 0.5 : 0;
        i.moveX = (-dz / l) * brain.circleSign * 0.8 + (dx / l) * keep;
        i.moveZ = (dx / l) * brain.circleSign * 0.8 + (dz / l) * keep;
        const dy = tp.y + (brain.circleSign > 0 ? 0.8 : -0.3) - p.y;
        i.moveY = Math.abs(dy) > 0.3 ? clamp(dy, -0.7, 0.7) : 0;
        if (brain.actionTicks > 45) brain.decisionCooldown = 0;
        break;
      }
      case 'special':
        i.special = true;
        brain.decisionCooldown = 0;
        break;
      case 'chase': {
        const tc = target.combatant!;
        if (tc.state === 'LAUNCHED' && c.unlockedMoves.includes('air_chase') && c.lastLaunchedTarget === target.id) i.action = 'air_chase';
        else if (c.unlockedMoves.includes('rush') && d < 9 && free) i.action = 'rush';
        else {
          this.moveToward(e, tp.x, tp.y, tp.z);
          if (free && d > 3) i.dash = true;
        }
        brain.decisionCooldown = Math.min(brain.decisionCooldown, 10);
        break;
      }
      case 'support':
        this.moveToward(e, tp.x, tp.y, tp.z);
        break;
    }
    void all;
  }

  private wander(e: Entity): void {
    const i = e.combatant!.intent;
    i.moveX = Math.sin(e.combatant!.ai.actionTicks * 0.03) * 0.3;
  }
}

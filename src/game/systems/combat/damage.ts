import { BALANCE } from '../../content/balance';
import type { MoveDef, Stats } from '../../content/types';

export interface DamageContext {
  /** Hits already landed in the current combo before this one. */
  comboCount: number;
  guarding: boolean;
  /** 0..1 random roll for critical hits (inject for determinism). */
  critRoll: number;
  attackerMultiplier?: number;
  bonusMultiplier?: number;
}

export interface DamageResult {
  damage: number;
  crit: boolean;
  scaling: number;
}

export function comboScaling(comboCount: number, moveScaling: number): number {
  return Math.max(BALANCE.combat.minComboScaling, 1 - 0.08 * comboCount) * moveScaling;
}

/**
 * damage = base * (1 + ATK/20) * 60/(60 + 3*DEF) * comboScaling * crit * guard
 * Physical moves use PhysicalAttack vs PhysicalDefense, Ki moves use KiAttack vs KiDefense.
 */
export function computeDamage(move: MoveDef, atk: Stats, def: Stats, ctx: DamageContext): DamageResult {
  const a = (move.damageType === 'ki' ? atk.kiAttack : atk.physicalAttack) * (ctx.attackerMultiplier ?? 1);
  const d = move.damageType === 'ki' ? def.kiDefense : def.physicalDefense;
  const scaling = comboScaling(ctx.comboCount, move.comboScaling);
  const crit = !ctx.guarding && ctx.critRoll < atk.criticalRate;
  let dmg = move.damage * (1 + a / 20) * (60 / (60 + 3 * d)) * scaling;
  if (crit) dmg *= BALANCE.combat.critMultiplier;
  if (ctx.guarding) dmg *= BALANCE.combat.guardDamageMultiplier;
  dmg *= ctx.bonusMultiplier ?? 1;
  return { damage: Math.max(1, Math.round(dmg)), crit, scaling };
}

export { spendKi } from './ki';

import type { Combatant } from '../../components';
import { BALANCE } from '../../content/balance';
import { TICK_DT } from '../../core/loop/FixedLoop';

const R = BALANCE.rage;

export const limitReady = (c: Combatant): boolean => c.team === 'player' && c.rage >= R.max;

export function addRage(c: Combatant, amount: number): boolean {
  if (c.team !== 'player' || amount <= 0) return false;
  const was = c.rage >= R.max;
  c.rage = Math.min(R.max, c.rage + amount);
  return !was && c.rage >= R.max;
}

/**
 * Main source: damage dealt by an enemy to an engaged hero. Self-inflicted
 * damage (Kaioken strain), allies, items and anything outside combat never
 * reach this function's success path. Returns true when the limit unlocks.
 */
export function rageFromDamage(defender: Combatant, attacker: Combatant, damage: number, blocked: boolean): boolean {
  if (defender === attacker || !defender.engaged || !attacker.engaged) return false;
  if (defender.team !== 'player' || attacker.team === defender.team) return false;
  const amount = (damage / Math.max(1, defender.stats.maxHp)) * R.perDamageFraction * (blocked ? R.blockedFactor : 1);
  return addRage(defender, amount);
}

/** Smaller contribution from active combat: landing hits on enemies. */
export function rageFromHitLanded(attacker: Combatant, defender: Combatant): boolean {
  if (!attacker.engaged || !defender.engaged || attacker.team !== 'player' || defender.team === attacker.team) return false;
  return addRage(attacker, R.perHitLanded);
}

/** Team dominance counts as active combat too. One simulation tick. */
export function rageFromDominance(c: Combatant): boolean {
  if (!c.engaged || c.state === 'DEFEATED') return false;
  return addRage(c, R.dominancePerSecond * TICK_DT);
}

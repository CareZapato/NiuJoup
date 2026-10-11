import { BALANCE } from '../../content/balance';
import { TICK_DT } from '../../core/loop/FixedLoop';

/**
 * The one ki model used on the map and in the arena. Every cost goes through
 * spendKi (charged once, never below zero); every rate uses simulation time,
 * so slow motion slows charging and regeneration too.
 */
interface KiHolder {
  ki: number;
  stats: { maxKi: number };
}

const KI = BALANCE.ki;

export const canAfford = (c: { ki: number }, cost: number): boolean => cost <= 0 || c.ki >= cost;

/** Returns false (and charges nothing) if the holder lacks ki. */
export function spendKi(c: { ki: number }, cost: number): boolean {
  if (cost <= 0) return true;
  if (c.ki < cost) return false;
  c.ki -= cost;
  return true;
}

/** Explicit small penalty (failed sequence). Clamped at zero. */
export function penalizeKi(c: { ki: number }, amount: number): number {
  const taken = Math.min(c.ki, Math.max(0, amount));
  c.ki -= taken;
  return taken;
}

export const regenCap = (c: KiHolder): number => c.stats.maxKi * KI.regenCapFraction;

/** Passive regeneration, limited to a fraction of max ki. One simulation tick. */
export function regenKi(c: KiHolder): void {
  const cap = regenCap(c);
  if (c.ki >= cap) return;
  c.ki = Math.min(cap, c.ki + KI.regenPerSecond * TICK_DT);
}

/** Manual charge. One simulation tick. */
export function chargeKi(c: KiHolder): void {
  c.ki = Math.min(c.stats.maxKi, c.ki + KI.chargePerSecond * TICK_DT);
}

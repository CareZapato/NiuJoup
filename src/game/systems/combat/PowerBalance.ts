import { BALANCE } from '../../content/balance';
import { TICK_DT } from '../../core/loop/FixedLoop';
import type { Team } from '../../content/types';

export type PowerReason = 'lightHit' | 'heavyHit' | 'kiHit' | 'comboFinisherBonus' | 'parry' | 'coordinatedAttack' | 'knockdown' | 'special';

/**
 * Shared tug-of-war bar in [-100, 100]. Positive = player team dominates.
 * Reaching the threshold grants DOMINANCE (Meteo Attack window) to that team.
 */
export class PowerBalance {
  value = 0;
  dominance: Team | null = null;
  dominanceTicks = 0;
  private cfg = BALANCE.powerBalance;
  windowBonusTicks = 0;

  reset(): void {
    this.value = 0;
    this.dominance = null;
    this.dominanceTicks = 0;
  }

  add(team: Team, amount: number): void {
    if (amount === 0) return;
    this.value += team === 'player' ? amount : -amount;
    if (this.value > this.cfg.max) this.value = this.cfg.max;
    if (this.value < this.cfg.min) this.value = this.cfg.min;
    this.checkDominance();
  }

  gain(team: Team, reason: PowerReason): void {
    this.add(team, this.cfg[reason]);
  }

  private checkDominance(): void {
    if (this.dominance) return;
    if (this.value >= this.cfg.dominanceThreshold) this.startDominance('player');
    else if (this.value <= -this.cfg.dominanceThreshold) this.startDominance('enemy');
  }

  private startDominance(team: Team): void {
    this.dominance = team;
    this.dominanceTicks = this.cfg.dominanceWindowTicks + this.windowBonusTicks;
  }

  canMeteo(team: Team): boolean {
    return this.dominance === team;
  }

  /** Called when a Meteo Attack starts: ends dominance and partially resets the bar. */
  consume(team: Team): boolean {
    if (this.dominance !== team) return false;
    this.dominance = null;
    this.dominanceTicks = 0;
    this.value *= this.cfg.resetFactorAfterMeteo;
    return true;
  }

  tick(): void {
    if (this.dominance) {
      this.dominanceTicks--;
      if (this.dominanceTicks <= 0) {
        this.dominance = null;
        this.value *= 0.5;
      }
      return;
    }
    const decay = this.cfg.passiveDecayPerSecond * TICK_DT;
    if (this.value > 0) this.value = Math.max(0, this.value - decay);
    else if (this.value < 0) this.value = Math.min(0, this.value + decay);
  }
}

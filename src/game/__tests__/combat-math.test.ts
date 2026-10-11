import { describe, expect, it } from 'vitest';
import { BALANCE } from '../content/balance';
import { CHARACTERS, ENEMIES } from '../content/characters';
import { getMove, MOVES, moveTotalTicks } from '../content/moves';
import { SKILLS } from '../content/skills';
import { comboScaling, computeDamage, spendKi } from '../systems/combat/damage';
import { PowerBalance } from '../systems/combat/PowerBalance';

const kaien = CHARACTERS.kaien.baseStats;
const sprout = ENEMIES.sprout.baseStats;

describe('damage formula', () => {
  it('follows base * (1+ATK/20) * 60/(60+3DEF) without crit or guard', () => {
    const m = getMove('light_1');
    const r = computeDamage(m, kaien, sprout, { comboCount: 0, guarding: false, critRoll: 1 });
    const expected = Math.round(m.damage * (1 + kaien.physicalAttack / 20) * (60 / (60 + 3 * sprout.physicalDefense)) * m.comboScaling);
    expect(r.damage).toBe(expected);
    expect(r.crit).toBe(false);
  });

  it('uses Ki stats for Ki moves', () => {
    const m = getMove('ki_blast');
    const strongKi = { ...kaien, kiAttack: 40, physicalAttack: 1 };
    const weakKi = { ...kaien, kiAttack: 1, physicalAttack: 40 };
    expect(computeDamage(m, strongKi, sprout, { comboCount: 0, guarding: false, critRoll: 1 }).damage).toBeGreaterThan(
      computeDamage(m, weakKi, sprout, { comboCount: 0, guarding: false, critRoll: 1 }).damage,
    );
  });

  it('applies crits, guard reduction and never deals less than 1', () => {
    const m = getMove('heavy');
    const base = computeDamage(m, kaien, sprout, { comboCount: 0, guarding: false, critRoll: 1 }).damage;
    const crit = computeDamage(m, kaien, sprout, { comboCount: 0, guarding: false, critRoll: 0 });
    expect(crit.crit).toBe(true);
    expect(crit.damage).toBeGreaterThan(base);
    const guarded = computeDamage(m, kaien, sprout, { comboCount: 0, guarding: true, critRoll: 0 });
    expect(guarded.crit).toBe(false);
    expect(guarded.damage).toBeLessThan(base);
    const tank = { ...sprout, physicalDefense: 10000 };
    expect(computeDamage(getMove('light_1'), kaien, tank, { comboCount: 20, guarding: true, critRoll: 1 }).damage).toBe(1);
  });

  it('scales combo damage down to a floor', () => {
    expect(comboScaling(0, 1)).toBe(1);
    expect(comboScaling(3, 1)).toBeCloseTo(0.76);
    expect(comboScaling(100, 1)).toBe(BALANCE.combat.minComboScaling);
  });
});

describe('Ki', () => {
  it('spends Ki only when affordable', () => {
    const c = { ki: 10 };
    expect(spendKi(c, 8)).toBe(true);
    expect(c.ki).toBe(2);
    expect(spendKi(c, 8)).toBe(false);
    expect(c.ki).toBe(2);
    expect(spendKi(c, 0)).toBe(true);
  });
});

describe('move frame data', () => {
  it('every move has valid frame data and hitboxes independent of animation', () => {
    for (const m of Object.values(MOVES)) {
      expect(m.startup, m.id).toBeGreaterThanOrEqual(0);
      expect(m.active, m.id).toBeGreaterThan(0);
      expect(m.recovery, m.id).toBeGreaterThanOrEqual(0);
      expect(moveTotalTicks(m)).toBe(m.startup + m.active + m.recovery);
      expect(m.hitbox.radius, m.id).toBeGreaterThan(0);
      if (m.unlockedBy) expect(SKILLS[m.unlockedBy]?.unlocksMoves, `${m.id} -> ${m.unlockedBy}`).toContain(m.id);
    }
  });
});

describe('Power Balance', () => {
  it('stays within [-100, 100] and grants dominance at the threshold', () => {
    const pb = new PowerBalance();
    pb.add('player', 500);
    expect(pb.value).toBe(100);
    expect(pb.dominance).toBe('player');
    expect(pb.canMeteo('player')).toBe(true);
    expect(pb.canMeteo('enemy')).toBe(false);
    pb.reset();
    pb.add('enemy', 500);
    expect(pb.value).toBe(-100);
    expect(pb.dominance).toBe('enemy');
  });

  it('consuming a Meteo ends dominance and partially resets the bar', () => {
    const pb = new PowerBalance();
    pb.add('player', BALANCE.powerBalance.dominanceThreshold);
    expect(pb.consume('enemy')).toBe(false);
    expect(pb.consume('player')).toBe(true);
    expect(pb.dominance).toBeNull();
    expect(pb.value).toBeCloseTo(BALANCE.powerBalance.dominanceThreshold * BALANCE.powerBalance.resetFactorAfterMeteo);
  });

  it('dominance expires after its window and the bar decays toward 0', () => {
    const pb = new PowerBalance();
    pb.add('player', 70);
    for (let i = 0; i < BALANCE.powerBalance.dominanceWindowTicks; i++) pb.tick();
    expect(pb.dominance).toBeNull();
    expect(pb.value).toBeCloseTo(35);
    for (let i = 0; i < 60 * 600; i++) pb.tick();
    expect(pb.value).toBe(0);
  });

  it('gain() uses configured amounts per reason', () => {
    const pb = new PowerBalance();
    pb.gain('player', 'lightHit');
    pb.gain('enemy', 'heavyHit');
    expect(pb.value).toBe(BALANCE.powerBalance.lightHit - BALANCE.powerBalance.heavyHit);
  });
});

import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../content/balance';
import { applyDayLook, createDayNight, stepDayNight } from './DayNight';

describe('day and night', () => {
  it('spends the configured day above the horizon and the night below it', () => {
    const state = createDayNight();
    state.phase = 0;
    applyDayLook(state);
    expect(state.elevation).toBeCloseTo(0, 5);
    state.phase = 0.25;
    applyDayLook(state);
    expect(state.elevation).toBeCloseTo(1, 5);
    expect(state.night).toBeLessThan(0.05);
    state.phase = 0.75;
    applyDayLook(state);
    expect(state.elevation).toBeCloseTo(-1, 5);
    expect(state.night).toBeGreaterThan(0.9);
    expect(state.sepia).toBeLessThan(0.05);
  });

  it('reaches dusk after daySeconds and midnight after day plus half the night', () => {
    const state = createDayNight();
    state.phase = 0;
    state.mode = 'auto';
    stepDayNight(state, BALANCE.dayNight.daySeconds, false);
    expect(state.phase).toBeCloseTo(0.5, 5);
    stepDayNight(state, BALANCE.dayNight.nightSeconds / 2, false);
    expect(state.phase).toBeCloseTo(0.75, 5);
  });

  it('holds a preset still while auto keeps moving', () => {
    const held = createDayNight();
    held.mode = 'afternoon';
    stepDayNight(held, 30, false);
    expect(held.phase).toBeCloseTo(0.42, 5);
    expect(held.sepia).toBeGreaterThan(0.4);
    expect(held.night).toBeLessThan(0.2);
    expect(held.lampsOn).toBeGreaterThan(0.7);
    const noon = createDayNight();
    expect(noon.lampsOn).toBeLessThan(0.05);
  });
});

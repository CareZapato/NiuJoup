import { BALANCE } from '../../content/balance';

/** How the clock advances. Presets lock the sun so the look can be tuned. */
export type DayMode = 'auto' | 'day' | 'afternoon' | 'night' | 'scrub';

export interface DayNightState {
  /** 0 dawn, 0.25 noon, 0.5 dusk, 0.75 midnight. A full turn is daySeconds + nightSeconds. */
  phase: number;
  mode: DayMode;
  /** 0 = hard edge, 1 = wide penumbra. */
  shadowSoftness: number;
  /** Multiplier for lamps, windows and ki glows. */
  lightBrightness: number;
  /** World radius of a path lamp's pool. */
  lampRadius: number;
  /** Unit direction of the sun on the ground. Shadows fall the opposite way. */
  sunX: number;
  sunZ: number;
  /** 1 at noon, 0 on the horizon, negative at night. */
  elevation: number;
  /** 0 at noon, 1 in the orange hour, back to 0 in full night. */
  sepia: number;
  /** 0 in full day, 1 in full night. Windows and lamps follow this. */
  night: number;
  /** Path lamps and house windows: off at noon, on from the afternoon through the night. */
  lampsOn: number;
  /** Multiply color of the world. Day stays near white; night drops toward blue. */
  ambient: [number, number, number];
}

const PRESET_PHASE: Record<Exclude<DayMode, 'auto' | 'scrub'>, number> = {
  day: 0.25,
  afternoon: 0.42,
  night: 0.75,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function createDayNight(): DayNightState {
  const D = BALANCE.dayNight;
  const state: DayNightState = {
    phase: 0.25,
    mode: 'auto',
    shadowSoftness: D.shadowSoftness,
    lightBrightness: D.lightBrightness,
    lampRadius: D.lampRadius,
    sunX: 0,
    sunZ: 1,
    elevation: 1,
    sepia: 0,
    night: 0,
    lampsOn: 0,
    ambient: [1, 1, 1],
  };
  applyDayLook(state);
  return state;
}

/** Advances the clock by real seconds. Presets and the scrubber do not move. */
export function stepDayNight(state: DayNightState, dt: number, reducedMotion: boolean): void {
  if (state.mode === 'auto') {
    const D = BALANCE.dayNight;
    const cycle = D.daySeconds + D.nightSeconds;
    const pace = reducedMotion ? 0.2 : 1;
    state.phase = (state.phase + (Math.max(0, dt) * pace) / cycle) % 1;
  } else if (state.mode !== 'scrub') {
    state.phase = PRESET_PHASE[state.mode];
  }
  applyDayLook(state);
}

/** Fills sun, sepia, night and ambient from the current phase and the tuned multipliers. */
export function applyDayLook(state: DayNightState): void {
  const p = state.phase;
  const elev = Math.sin(p * Math.PI * 2);
  state.elevation = elev;
  let x = Math.cos(p * Math.PI * 2);
  let z = Math.sin(p * Math.PI * 2) * 0.55;
  const len = Math.hypot(x, z) || 1;
  state.sunX = x / len;
  state.sunZ = z / len;
  const low = smoothstep(0.9, 0.18, elev);
  const night = smoothstep(0.15, -0.28, elev);
  state.night = night;
  state.lampsOn = smoothstep(0.82, 0.42, elev);
  state.sepia = low * (1 - night);
  const day: [number, number, number] = [1, 0.98, 0.94];
  const amber: [number, number, number] = [1, 0.78, 0.52];
  const dark: [number, number, number] = [0.22, 0.28, 0.48];
  const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  state.ambient = mix(mix(day, amber, state.sepia), dark, night);
  state.shadowSoftness = clamp01(state.shadowSoftness);
  state.lightBrightness = Math.min(3, Math.max(0, state.lightBrightness));
  state.lampRadius = Math.min(12, Math.max(0.5, state.lampRadius));
}

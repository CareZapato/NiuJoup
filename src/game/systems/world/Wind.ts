import { BALANCE } from '../../content/balance';

/** Shared valley wind. `dirX/dirZ` is the direction it blows toward. */
export interface WindState {
  dirX: number;
  dirZ: number;
  /** 0..1. Gusts rise and fall; the direction turns slowly. */
  strength: number;
  angle: number;
}

export function createWind(seed = 1996): WindState {
  const angle = (seed % 360) * 0.017;
  return { dirX: Math.sin(angle), dirZ: Math.cos(angle), strength: 0.45, angle };
}

/** Advances the wind by one simulation tick. */
export function stepWind(w: WindState, tick: number, reducedMotion: boolean): void {
  const W = BALANCE.wind;
  const pace = reducedMotion ? 0.2 : 1;
  w.angle += W.turnPerTick * pace;
  const gust = 0.5 + 0.5 * Math.sin(tick * W.gustSpeed * pace);
  const flutter = 0.5 + 0.5 * Math.sin(tick * W.flutterSpeed * pace + 1.7);
  w.strength = W.minStrength + (W.maxStrength - W.minStrength) * gust * (0.7 + 0.3 * flutter);
  if (reducedMotion) w.strength *= 0.35;
  w.dirX = Math.sin(w.angle);
  w.dirZ = Math.cos(w.angle);
}

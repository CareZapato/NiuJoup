import { BALANCE } from '../../content/balance';

/** Shared valley wind. `dirX/dirZ` is the direction it blows toward. */
export interface WindState {
  dirX: number;
  dirZ: number;
  /** 0..1. One slow gust. No fast flutter, so the lean does not shiver. */
  strength: number;
  /** Wrapped, so the sine never loses precision after a long session. */
  angle: number;
  gust: number;
}

export function createWind(seed = 1996): WindState {
  const angle = (seed % 360) * 0.017;
  return { dirX: Math.sin(angle), dirZ: Math.cos(angle), strength: 0.45, angle, gust: 0.8 };
}

/** Advances the wind by one simulation tick. */
export function stepWind(w: WindState, _tick: number, reducedMotion: boolean): void {
  const W = BALANCE.wind;
  const pace = reducedMotion ? 0.2 : 1;
  const tau = Math.PI * 2;
  w.angle = (w.angle + W.turnPerTick * pace) % tau;
  w.gust = (w.gust + W.gustSpeed * pace) % tau;
  const gust = 0.5 + 0.5 * Math.sin(w.gust);
  w.strength = W.minStrength + (W.maxStrength - W.minStrength) * gust;
  if (reducedMotion) w.strength *= 0.35;
  w.dirX = Math.sin(w.angle);
  w.dirZ = Math.cos(w.angle);
}

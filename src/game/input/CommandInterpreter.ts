import { MOVES } from '../content/moves';
import type { CommandPattern, MoveDef, NumpadDir } from '../content/types';
import { BUTTON_BITS, type InputBuffer, type InputFrame } from './InputBuffer';

export interface InterpreterConfig {
  /** Max ticks to complete a directional sequence. */
  sequenceWindow: number;
  /** Max spread between buttons in a simultaneous press. */
  simultaneousWindow: number;
  /** Max ticks between taps for a double tap. */
  doubleTapWindow: number;
}

export const DEFAULT_INTERPRETER: InterpreterConfig = { sequenceWindow: 20, simultaneousWindow: 4, doubleTapWindow: 14 };

/** Accessibility: scales all windows (1 = default, 1.5 = more lenient). */
export function scaledConfig(mult: number): InterpreterConfig {
  return {
    sequenceWindow: Math.round(DEFAULT_INTERPRETER.sequenceWindow * mult),
    simultaneousWindow: Math.round(DEFAULT_INTERPRETER.simultaneousWindow * mult),
    doubleTapWindow: Math.round(DEFAULT_INTERPRETER.doubleTapWindow * mult),
  };
}

const DIAGONALS: Record<number, number[]> = { 6: [3, 9], 4: [1, 7], 8: [7, 9], 2: [1, 3] };

function dirMatches(want: NumpadDir, got: NumpadDir, lenient: boolean): boolean {
  if (want === got) return true;
  return lenient && (DIAGONALS[want]?.includes(got) ?? false);
}

function pressedWithin(buf: InputBuffer, bit: number, window: number): boolean {
  for (let i = 0; i < window; i++) {
    const f = buf.at(i);
    if (!f) return false;
    if (f.pressed & bit) return true;
  }
  return false;
}

function sequenceMatches(buf: InputBuffer, seq: NumpadDir[], window: number): boolean {
  let want = seq.length - 1;
  const newest = buf.at(0);
  if (!newest) return false;
  for (let i = 0; i < buf.size && want >= 0; i++) {
    const f = buf.at(i) as InputFrame;
    if (newest.tick - f.tick > window) return false;
    // The final direction may be a diagonal (still holding the previous key).
    if (dirMatches(seq[want], f.dir, want === seq.length - 1)) want--;
  }
  return want < 0;
}

export function patternMatches(buf: InputBuffer, p: CommandPattern, cfg: InterpreterConfig): boolean {
  const f = buf.at(0);
  if (!f) return false;
  if (p.chargeTicks !== undefined) {
    const bit = BUTTON_BITS[p.buttons[0]];
    if (!(f.released & bit)) return false;
    if (f.heldDuration[Math.log2(bit)] < p.chargeTicks) return false;
  } else {
    let anyNow = false;
    for (const b of p.buttons) {
      const bit = BUTTON_BITS[b];
      if (f.pressed & bit) anyNow = true;
      else if (!pressedWithin(buf, bit, cfg.simultaneousWindow)) return false;
    }
    if (!anyNow) return false;
  }
  if (p.held) for (const b of p.held) if (!(f.held & BUTTON_BITS[b])) return false;
  if (p.holdDir && !p.holdDir.includes(f.dir)) return false;
  if (p.sequence && !sequenceMatches(buf, p.sequence, cfg.sequenceWindow)) return false;
  return true;
}

/**
 * Resolves the newest input frame into a move id. Higher-priority commands
 * (longer motions, simultaneous presses) win over plain button presses.
 * Locked moves are never returned.
 */
export function interpretCommand(buf: InputBuffer, unlocked: readonly string[], cfg: InterpreterConfig = DEFAULT_INTERPRETER): string | null {
  let best: MoveDef | null = null;
  for (const id of unlocked) {
    const m = MOVES[id];
    if (!m?.command) continue;
    if (best && (best.command as CommandPattern).priority >= m.command.priority) continue;
    if (patternMatches(buf, m.command, cfg)) best = m;
  }
  return best ? best.id : null;
}

/** Detects a double tap of the same non-neutral direction (5 -> d -> 5 -> d). */
export function detectDoubleTap(buf: InputBuffer, cfg: InterpreterConfig = DEFAULT_INTERPRETER): NumpadDir | null {
  const f0 = buf.at(0);
  const f1 = buf.at(1);
  if (!f0 || !f1 || f0.dir === 5 || f1.dir === f0.dir) return null;
  const d = f0.dir;
  let stage = 0;
  for (let i = 1; i < buf.size; i++) {
    const f = buf.at(i) as InputFrame;
    if (f0.tick - f.tick > cfg.doubleTapWindow) return null;
    if (stage === 0) {
      if (f.dir !== 5) return null;
      stage = 1;
    } else if (f.dir === d) return d;
    else if (f.dir !== 5) return null;
  }
  return null;
}

/** J, J, K style chains: (current move, requested base move) -> chained move. */
export const CHAINS: Record<string, Record<string, string>> = {
  light_1: { light_1: 'light_2', heavy: 'heavy_finisher' },
  light_2: { heavy: 'heavy_finisher', light_1: 'heavy_finisher' },
  rush: { light_1: 'light_1' },
};

export function resolveChain(currentMove: string | null, requested: string): string {
  if (!currentMove) return requested;
  return CHAINS[currentMove]?.[requested] ?? requested;
}

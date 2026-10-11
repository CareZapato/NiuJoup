import { BALANCE } from '../../content/balance';
import type { FocusSymbol } from '../../content/types';

export type FocusResult = 'success' | 'invalid' | 'timeout' | 'interrupted' | 'cancelled';

export interface FocusCandidate {
  moveId: string;
  name: string;
  sequence: FocusSymbol[];
  mode: 'spread' | 'concentrate';
  limit: boolean;
}

export interface FocusOutcome {
  result: FocusResult;
  casterId: number;
  candidate: FocusCandidate | null;
  /** Candidates still possible right before the sequence failed (penalty attribution). */
  remaining: FocusCandidate[];
  preselected: string | null;
}

const F = BALANCE.focus;

/** True when no sequence is a prefix of another (including equal sequences). */
export function isPrefixFree(seqs: readonly (readonly string[])[]): boolean {
  for (let i = 0; i < seqs.length; i++) {
    for (let j = 0; j < seqs.length; j++) {
      if (i === j) continue;
      const a = seqs[i];
      const b = seqs[j];
      if (a.length <= b.length && a.every((s, k) => b[k] === s)) return false;
    }
  }
  return true;
}

/**
 * Focus-combo state machine. Runs on REAL time: the 3 s window and input
 * reading never slow down with the world. The game owns the simulation clock
 * and applies the slow-motion scale while `active` is true.
 */
export class FocusController {
  active = false;
  casterId = -1;
  /** Real seconds since the sequence started. */
  elapsed = 0;
  input: FocusSymbol[] = [];
  candidates: FocusCandidate[] = [];
  preselected: string | null = null;
  /** Target direction on screen captured at start: forward/back stay fixed. */
  private fx = 1;
  private fy = 0;
  private stickDir: FocusSymbol | null = null;
  private stickNeutral = true;

  get remainingSeconds(): number {
    return this.active ? Math.max(0, F.windowSeconds - this.elapsed) : 0;
  }

  start(casterId: number, candidates: FocusCandidate[], preselected: string | null, targetScreenX: number, targetScreenY: number): boolean {
    if (this.active || candidates.length === 0) return false;
    this.active = true;
    this.casterId = casterId;
    this.elapsed = 0;
    this.input = [];
    this.candidates = candidates;
    this.preselected = preselected;
    const l = Math.hypot(targetScreenX, targetScreenY);
    this.fx = l > 1e-3 ? targetScreenX / l : 1;
    this.fy = l > 1e-3 ? targetScreenY / l : 0;
    // A stick already pushed at start must return to neutral first.
    this.stickDir = null;
    this.stickNeutral = false;
    return true;
  }

  /** Candidates whose sequence still matches the input so far. */
  matching(): FocusCandidate[] {
    return this.candidates.filter((c) => this.input.every((s, i) => c.sequence[i] === s));
  }

  /** Feed one symbol. Returns an outcome when the sequence resolves. */
  push(sym: FocusSymbol): FocusOutcome | null {
    if (!this.active) return null;
    const before = this.matching();
    this.input.push(sym);
    const now = this.matching();
    if (now.length === 0) return this.finish('invalid', null, before);
    const exact = now.find((c) => c.sequence.length === this.input.length);
    if (exact) return this.finish('success', exact, now);
    return null;
  }

  /**
   * Screen-space stick sample. A direction counts once; repeating it (or
   * entering any direction after start) requires returning to neutral.
   */
  stick(x: number, y: number): FocusOutcome | null {
    if (!this.active) return null;
    const mag = Math.hypot(x, y);
    if (mag < F.stickOff) {
      this.stickNeutral = true;
      this.stickDir = null;
      return null;
    }
    if (mag < F.stickOn) return null;
    const dir = this.symbolFor(x, y);
    if (dir === this.stickDir) return null;
    if (!this.stickNeutral && this.stickDir === null) return null;
    this.stickDir = dir;
    this.stickNeutral = false;
    return this.push(dir);
  }

  /** Maps a screen direction to F/B/U/D using the orientation fixed at start. */
  symbolFor(x: number, y: number): FocusSymbol {
    const mag = Math.hypot(x, y) || 1;
    const ix = x / mag;
    const iy = y / mag;
    const fwd = ix * this.fx + iy * this.fy;
    const sign = this.fx >= 0 ? 1 : -1;
    const lat = (ix * -this.fy + iy * this.fx) * sign;
    return Math.abs(fwd) >= Math.abs(lat) ? (fwd > 0 ? 'F' : 'B') : lat > 0 ? 'U' : 'D';
  }

  /** Advance the real-time window. */
  update(realDt: number): FocusOutcome | null {
    if (!this.active) return null;
    this.elapsed += Math.max(0, realDt);
    // Epsilon: 180 frames of 1/60 s must close the window exactly at 3 s despite float drift.
    if (this.elapsed >= F.windowSeconds - 1e-6) return this.finish('timeout', null, this.matching());
    return null;
  }

  interrupt(): FocusOutcome | null {
    return this.active ? this.finish('interrupted', null, this.matching()) : null;
  }

  cancel(): FocusOutcome | null {
    return this.active ? this.finish('cancelled', null, this.matching()) : null;
  }

  private finish(result: FocusResult, candidate: FocusCandidate | null, remaining: FocusCandidate[]): FocusOutcome {
    const out: FocusOutcome = { result, casterId: this.casterId, candidate, remaining, preselected: this.preselected };
    this.active = false;
    this.casterId = -1;
    this.input = [];
    this.candidates = [];
    this.preselected = null;
    return out;
  }
}

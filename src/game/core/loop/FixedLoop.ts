export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

/**
 * Fixed-timestep accumulator. The renderer calls advance() with the real frame
 * delta; simulation always steps at exactly 60 Hz. Large deltas (tab switch,
 * GC pause) are clamped so the game never "spirals" trying to catch up.
 */
export class FixedLoop {
  private accumulator = 0;
  tick = 0;
  paused = false;
  /** Max simulation steps per rendered frame; lower = graceful slow-motion under load. */
  maxStepsPerFrame = 5;

  constructor(private readonly step: (tick: number) => void) {}

  /** Returns interpolation alpha in [0,1) for rendering between the last two states. */
  advance(frameDeltaSeconds: number): number {
    if (this.paused) return 0;
    this.accumulator += Math.min(frameDeltaSeconds, 0.25);
    let steps = 0;
    while (this.accumulator >= TICK_DT && steps < this.maxStepsPerFrame) {
      this.step(this.tick);
      this.tick++;
      this.accumulator -= TICK_DT;
      steps++;
    }
    if (steps === this.maxStepsPerFrame) this.accumulator = Math.min(this.accumulator, TICK_DT);
    return this.accumulator / TICK_DT;
  }

  reset(): void {
    this.accumulator = 0;
  }
}

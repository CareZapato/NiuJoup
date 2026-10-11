import type { BindAction } from '../settings';

/**
 * Device-agnostic input state. Every physical source that can hold an action
 * (a keyboard key, a touch pointer, a gamepad button) is a separate *holder*:
 * an action stays held while at least one holder keeps it down, so releasing
 * one finger or one of two bound keys never cancels the other.
 *
 * Press/release edges are monotonic counters instead of a "last key" flag, so
 * any number of consumers (the 60 Hz simulation, the real-time focus reader)
 * can sample at their own rate and never miss a tap that started and ended
 * between two samples.
 */
export class RawInput {
  private holders = new Map<BindAction, Set<string>>();
  private presses = new Map<BindAction, number>();
  private releases = new Map<BindAction, number>();
  /** Analog stick owned by a single touch pointer (screen space, y up). */
  touchStick = { x: 0, y: 0 };
  touchStickOwner: string | null = null;
  padStick = { x: 0, y: 0 };

  press(a: BindAction, holder: string): void {
    let set = this.holders.get(a);
    if (!set) {
      set = new Set();
      this.holders.set(a, set);
    }
    if (set.has(holder)) return;
    set.add(holder);
    if (set.size === 1) this.presses.set(a, (this.presses.get(a) ?? 0) + 1);
  }

  release(a: BindAction, holder: string): void {
    const set = this.holders.get(a);
    if (!set || !set.delete(holder)) return;
    if (set.size === 0) this.releases.set(a, (this.releases.get(a) ?? 0) + 1);
  }

  /** Momentary press (UI tap): counts as one press and one release. */
  tap(a: BindAction): void {
    if (this.held(a)) return;
    this.presses.set(a, (this.presses.get(a) ?? 0) + 1);
    this.releases.set(a, (this.releases.get(a) ?? 0) + 1);
  }

  /** Releases every action held by holders whose id starts with `prefix`. */
  releaseHolders(prefix: string): void {
    for (const [a, set] of this.holders) {
      for (const h of [...set]) if (h.startsWith(prefix)) this.release(a, h);
    }
    if (this.touchStickOwner?.startsWith(prefix)) this.setTouchStick(0, 0, null);
  }

  // Compatibility helpers (tests, gamepad polling).
  setKey(a: BindAction, down: boolean, code: string = a): void {
    if (down) this.press(a, `kb:${code}`);
    else this.release(a, `kb:${code}`);
  }

  setPad(a: BindAction, down: boolean): void {
    if (down) this.press(a, 'pad');
    else this.release(a, 'pad');
  }

  setTouchStick(x: number, y: number, owner: string | null = this.touchStickOwner): void {
    this.touchStick.x = x;
    this.touchStick.y = y;
    this.touchStickOwner = owner;
  }

  held(a: BindAction): boolean {
    return (this.holders.get(a)?.size ?? 0) > 0;
  }

  pressCount(a: BindAction): number {
    return this.presses.get(a) ?? 0;
  }

  releaseCount(a: BindAction): number {
    return this.releases.get(a) ?? 0;
  }

  heldActions(): BindAction[] {
    const out: BindAction[] = [];
    for (const [a, set] of this.holders) if (set.size > 0) out.push(a);
    return out;
  }

  /** Screen-space stick: x right, y up, magnitude clamped to 1. */
  stick(out: { x: number; y: number }, sensitivity = 1): { x: number; y: number } {
    let x = (this.held('stickRight') ? 1 : 0) - (this.held('stickLeft') ? 1 : 0);
    let y = (this.held('stickUp') ? 1 : 0) - (this.held('stickDown') ? 1 : 0);
    x += this.touchStick.x * sensitivity + this.padStick.x;
    y += this.touchStick.y * sensitivity + this.padStick.y;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    out.x = x;
    out.y = y;
    return out;
  }

  /** Focus lost, tab hidden, gesture cancelled or app paused. */
  releaseAll(): void {
    for (const [a, set] of this.holders) for (const h of [...set]) this.release(a, h);
    this.touchStick.x = this.touchStick.y = 0;
    this.touchStickOwner = null;
    this.padStick.x = this.padStick.y = 0;
  }
}

/**
 * Independent edge reader over a RawInput. Each consumer keeps its own last
 * seen counters, so sampling in one place never steals edges from another.
 */
export class InputReader {
  private lastPress = new Map<BindAction, number>();
  private lastRelease = new Map<BindAction, number>();
  /** Actions that must be released before they count as held again. */
  private suppressed = new Set<BindAction>();
  readonly pressed = new Set<BindAction>();
  readonly released = new Set<BindAction>();

  constructor(
    private readonly raw: RawInput,
    private readonly actions: readonly BindAction[],
  ) {}

  sample(): void {
    this.pressed.clear();
    this.released.clear();
    for (const a of this.actions) {
      const p = this.raw.pressCount(a);
      const r = this.raw.releaseCount(a);
      if (p !== (this.lastPress.get(a) ?? 0)) {
        this.lastPress.set(a, p);
        if (!this.suppressed.has(a)) this.pressed.add(a);
      }
      if (r !== (this.lastRelease.get(a) ?? 0)) {
        this.lastRelease.set(a, r);
        this.released.add(a);
      }
      if (this.suppressed.has(a) && !this.raw.held(a)) this.suppressed.delete(a);
    }
  }

  held(a: BindAction): boolean {
    return this.raw.held(a) && !this.suppressed.has(a);
  }

  /** Drops pending edges and ignores everything currently held until released. */
  resync(): void {
    for (const a of this.actions) {
      this.lastPress.set(a, this.raw.pressCount(a));
      this.lastRelease.set(a, this.raw.releaseCount(a));
      if (this.raw.held(a)) this.suppressed.add(a);
    }
    this.pressed.clear();
    this.released.clear();
  }
}

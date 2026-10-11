import type { BindAction } from '../settings';

/**
 * Device-agnostic input state. Keyboard (web), on-screen touch controls and
 * gamepads all write here; the game samples it once per simulation tick.
 */
export class RawInput {
  private keyboard = new Set<BindAction>();
  private touch = new Set<BindAction>();
  private pad = new Set<BindAction>();
  touchStick = { x: 0, y: 0 };
  padStick = { x: 0, y: 0 };
  /** One-shot actions from UI buttons (consumed on next tick). */
  private pulses = new Set<BindAction>();

  setKey(a: BindAction, down: boolean): void {
    if (down) this.keyboard.add(a);
    else this.keyboard.delete(a);
  }

  setTouch(a: BindAction, down: boolean): void {
    if (down) this.touch.add(a);
    else this.touch.delete(a);
  }

  setPad(a: BindAction, down: boolean): void {
    if (down) this.pad.add(a);
    else this.pad.delete(a);
  }

  setTouchStick(x: number, y: number): void {
    this.touchStick.x = x;
    this.touchStick.y = y;
  }

  pulse(a: BindAction): void {
    this.pulses.add(a);
  }

  held(a: BindAction): boolean {
    return this.keyboard.has(a) || this.touch.has(a) || this.pad.has(a) || this.pulses.has(a);
  }

  consumePulses(): void {
    this.pulses.clear();
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

  releaseAll(): void {
    this.keyboard.clear();
    this.touch.clear();
    this.pad.clear();
    this.pulses.clear();
    this.touchStick.x = this.touchStick.y = 0;
    this.padStick.x = this.padStick.y = 0;
  }
}

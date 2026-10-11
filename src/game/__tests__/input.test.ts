import { describe, expect, it } from 'vitest';
import type { ButtonId, NumpadDir } from '../content/types';
import { DEFAULT_INTERPRETER, detectDoubleTap, interpretCommand, resolveChain, scaledConfig } from '../input/CommandInterpreter';
import { BUTTON_BITS, InputBuffer, relativeDir } from '../input/InputBuffer';

const ALL = ['light_1', 'heavy', 'ki_blast', 'launcher', 'rising_strike', 'rush', 'ki_wave', 'meteor_impact', 'charged_shot', 'ki_barrage'];
const BASIC = ['light_1', 'heavy', 'ki_blast'];

/** Feeds one frame per entry: [dir, buttons held]. Returns the buffer. */
function feed(frames: [NumpadDir, ButtonId[]][], buf = new InputBuffer(), startTick = 0): InputBuffer {
  frames.forEach(([dir, held], i) => buf.push(startTick + i, dir, held.reduce((m, b) => m | BUTTON_BITS[b], 0)));
  return buf;
}

describe('InputBuffer', () => {
  it('computes pressed/released edges and held duration', () => {
    const buf = feed([
      [5, []],
      [5, ['light']],
      [5, ['light']],
      [5, ['light']],
      [5, []],
    ]);
    expect(buf.at(3)!.pressed & BUTTON_BITS.light).toBeTruthy();
    expect(buf.at(2)!.pressed & BUTTON_BITS.light).toBeFalsy();
    const last = buf.at(0)!;
    expect(last.released & BUTTON_BITS.light).toBeTruthy();
    expect(last.heldDuration[0]).toBe(3);
  });

  it('is a fixed-size ring buffer that reuses frames', () => {
    const buf = new InputBuffer(8);
    const first = buf.push(0, 5, 0);
    for (let t = 1; t < 8; t++) buf.push(t, 5, 0);
    expect(buf.size).toBe(8);
    const reused = buf.push(8, 6, 0);
    expect(reused).toBe(first);
    expect(buf.size).toBe(8);
    expect(buf.at(0)!.tick).toBe(8);
    expect(buf.at(8)).toBeNull();
  });
});

describe('command interpreter', () => {
  it('J -> light, K -> heavy, L -> ki blast', () => {
    expect(interpretCommand(feed([[5, []], [5, ['light']]]), ALL)).toBe('light_1');
    expect(interpretCommand(feed([[5, []], [5, ['heavy']]]), ALL)).toBe('heavy');
    expect(interpretCommand(feed([[5, []], [5, ['ki']]]), ALL)).toBe('ki_blast');
  });

  it('J + K within the simultaneous window -> launcher', () => {
    const buf = feed([[5, []], [5, ['light']], [5, ['light']], [5, ['light', 'heavy']]]);
    expect(interpretCommand(buf, ALL)).toBe('launcher');
    const late = feed([[5, []], [5, ['light']], ...Array.from({ length: 8 }, (): [NumpadDir, ButtonId[]] => [5, ['light']]), [5, ['light', 'heavy']]]);
    expect(interpretCommand(late, ALL)).toBe('heavy');
  });

  it('S, D + J -> rising strike (diagonal tolerated on the last step)', () => {
    const buf = feed([
      [5, []],
      [2, []],
      [2, []],
      [3, []],
      [6, ['light']],
    ]);
    expect(interpretCommand(buf, ALL)).toBe('rising_strike');
    const diag = feed([[5, []], [2, []], [3, ['light']]]);
    expect(interpretCommand(diag, ALL)).toBe('rising_strike');
  });

  it('S, D + L -> ki wave; A, D + L -> ki barrage', () => {
    expect(interpretCommand(feed([[5, []], [2, []], [6, ['ki']]]), ALL)).toBe('ki_wave');
    expect(interpretCommand(feed([[5, []], [4, []], [5, []], [6, ['ki']]]), ALL)).toBe('ki_barrage');
  });

  it('D, S, A + K -> meteor impact (highest priority wins)', () => {
    const buf = feed([
      [5, []],
      [6, []],
      [3, []],
      [2, []],
      [1, []],
      [4, ['heavy']],
    ]);
    expect(interpretCommand(buf, ALL)).toBe('meteor_impact');
  });

  it('Shift + W + J -> rush', () => {
    const buf = feed([
      [5, ['dash']],
      [8, ['dash']],
      [8, ['dash', 'light']],
    ]);
    expect(interpretCommand(buf, ALL)).toBe('rush');
  });

  it('holding L for 40 ticks and releasing -> charged shot', () => {
    const frames: [NumpadDir, ButtonId[]][] = [[5, []]];
    for (let i = 0; i < 42; i++) frames.push([5, ['ki']]);
    frames.push([5, []]);
    expect(interpretCommand(feed(frames), ALL)).toBe('charged_shot');
    const short: [NumpadDir, ButtonId[]][] = [[5, []], [5, ['ki']], [5, ['ki']], [5, []]];
    expect(interpretCommand(feed(short), ALL)).toBeNull();
  });

  it('locked moves are never executed: the input falls back to the basic move', () => {
    const motion = feed([[5, []], [2, []], [6, ['light']]]);
    expect(interpretCommand(motion, BASIC)).toBe('light_1');
    const jk = feed([[5, []], [5, ['light']], [5, ['light', 'heavy']]]);
    expect(interpretCommand(jk, BASIC)).toBe('heavy');
    expect(interpretCommand(feed([[5, []], [6, []], [2, []], [4, ['heavy']]]), BASIC)).toBe('heavy');
  });

  it('accessibility: wider windows accept slower motions', () => {
    const frames: [NumpadDir, ButtonId[]][] = [[5, []], [2, []]];
    for (let i = 0; i < 26; i++) frames.push([5, []]);
    frames.push([6, ['light']]);
    expect(interpretCommand(feed(frames), ALL, DEFAULT_INTERPRETER)).toBe('light_1');
    expect(interpretCommand(feed(frames), ALL, scaledConfig(2))).toBe('rising_strike');
  });

  it('double tap of the same direction is detected only within the window', () => {
    expect(detectDoubleTap(feed([[5, []], [6, []], [5, []], [5, []], [6, []]]))).toBe(6);
    expect(detectDoubleTap(feed([[5, []], [6, []], [5, []], [4, []]]))).toBeNull();
    const slow: [NumpadDir, ButtonId[]][] = [[6, []]];
    for (let i = 0; i < 20; i++) slow.push([5, []]);
    slow.push([6, []]);
    expect(detectDoubleTap(feed(slow))).toBeNull();
  });

  it('J, J, K chains through light_2 into the heavy finisher', () => {
    expect(resolveChain(null, 'light_1')).toBe('light_1');
    expect(resolveChain('light_1', 'light_1')).toBe('light_2');
    expect(resolveChain('light_2', 'heavy')).toBe('heavy_finisher');
    expect(resolveChain('light_1', 'ki_blast')).toBe('ki_blast');
  });
});

describe('relative directions', () => {
  it('6 means toward the target and mirrors when sides switch', () => {
    expect(relativeDir(1, 0, 1, 0)).toBe(6);
    expect(relativeDir(-1, 0, 1, 0)).toBe(4);
    expect(relativeDir(0, 1, 1, 0)).toBe(8);
    expect(relativeDir(0, -1, 1, 0)).toBe(2);
    expect(relativeDir(-1, 0, -1, 0)).toBe(6);
    expect(relativeDir(1, 0, -1, 0)).toBe(4);
    expect(relativeDir(0, 1, -1, 0)).toBe(8);
    expect(relativeDir(0.7, 0.7, 1, 0)).toBe(9);
    expect(relativeDir(0.1, 0.1, 1, 0)).toBe(5);
  });
});

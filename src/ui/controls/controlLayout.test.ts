import { describe, expect, it } from 'vitest';
import { controlsOverlap, layoutControls, type LayoutInput } from './controlLayout';

const INSETS = { left: 0, right: 0, top: 0, bottom: 0 };

function assertPacked(input: LayoutInput): void {
  const { controls, stick } = layoutControls(input);
  const circles = stick ? [...controls, stick] : controls;
  expect(circles.length).toBeGreaterThan(3);
  for (const c of circles) {
    expect(c.x - c.r).toBeGreaterThanOrEqual(input.insets.left - 1);
    expect(c.x + c.r).toBeLessThanOrEqual(input.w - input.insets.right + 1);
    expect(c.y - c.r).toBeGreaterThanOrEqual(input.insets.top - 1);
    expect(c.y + c.r).toBeLessThanOrEqual(input.h - input.insets.bottom + 1);
  }
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      expect(controlsOverlap(circles[i]!, circles[j]!, 3)).toBe(false);
    }
  }
  const keys = new Set(controls.map((c) => c.key));
  expect(keys.has('light')).toBe(input.touch);
  expect(keys.has('slot0')).toBe(true);
  if (input.combat) {
    expect(keys.has('guard')).toBe(input.touch);
    expect(keys.has('focus')).toBe(true);
    if (input.hasLimit) expect(keys.has('limit')).toBe(true);
  }
}

describe('on-screen controls do not overlap', () => {
  const screens: [string, number, number][] = [
    ['pc', 1920, 1080],
    ['pc window', 1280, 720],
    ['phone landscape', 844, 390],
    ['phone landscape small', 640, 320],
    ['phone portrait', 390, 844],
    ['phone portrait small', 360, 740],
    ['tablet landscape', 1024, 768],
    ['tablet portrait', 768, 1024],
  ];
  for (const [name, w, h] of screens) {
    for (const touch of [true, false]) {
      for (const combat of [true, false]) {
        for (const scale of [0.8, 1, 1.5]) {
          it(`${name} ${w}x${h} ${touch ? 'touch' : 'keyboard'} ${combat ? 'combat' : 'walk'} scale ${scale}`, () => {
            assertPacked({
              combat,
              slotCount: 4,
              hasLimit: combat,
              w,
              h,
              insets: name.startsWith('phone') ? { left: 0, right: 0, top: 24, bottom: 16 } : INSETS,
              scale,
              touch,
            });
          });
        }
      }
    }
  }
});

import { describe, expect, it } from 'vitest';
import { BALANCE } from '../content/balance';
import { Game } from '../Game';

const ASPECTS = [16 / 9, 19.5 / 9, 4 / 3, 9 / 16, 9 / 19.5];

function place(g: Game, x: number, z: number): void {
  const l = g.leader();
  l.transform.pos.x = x;
  l.transform.pos.z = z;
  l.transform.prev.x = x;
  l.transform.prev.z = z;
}

describe('camera stays on the chosen character', () => {
  const ex = BALANCE.camera.exploration;

  for (const aspect of ASPECTS) {
    it(`walking keeps the leader centred at aspect ${aspect.toFixed(2)}, including the corners`, () => {
      const g = new Game();
      g.newGame('kaien');
      g.viewAspect = aspect;
      const t = g.map.tiles;
      for (const [x, z] of [
        [2, 2],
        [t.width - 2, 2],
        [2, t.height - 2],
        [t.width - 2, t.height - 2],
      ]) {
        place(g, x, z);
        g.frame(1 / 60);
        const l = g.leader();
        expect(g.camera.pose.focus.x).toBeCloseTo(l.transform.pos.x, 3);
        expect(g.camera.pose.focus.z).toBeCloseTo(l.transform.pos.z, 3);
        expect(g.camera.pose.focus.y).toBeCloseTo(l.transform.pos.y, 3);
      }
    });
  }

  it('a battle keeps the controlled fighter centred and zooms in, in portrait and landscape', () => {
    expect(BALANCE.camera.zoomOut).toBeCloseTo(1.15);
    expect(BALANCE.camera.combat.max * BALANCE.camera.zoomOut).toBeLessThan(ex.distance * BALANCE.camera.zoomOut);
    for (const aspect of [16 / 9, 9 / 16]) {
      const g = new Game();
      g.newGame('kaien');
      g.viewAspect = aspect;
      for (let i = 0; i < 20; i++) g.frame(1 / 60);
      const explore = g.camera.pose.distance;
      expect(explore).toBeCloseTo(ex.distance * BALANCE.camera.zoomOut, 0);
      const t = g.map.tiles;
      place(g, 3, t.height - 3);
      g.debugEncounter();
      for (let i = 0; i < 8; i++) g.frame(1 / 60);
      const c = g.controlled()!;
      expect(g.camera.pose.focus.x).toBeCloseTo(c.transform.pos.x, 3);
      expect(g.camera.pose.focus.z).toBeCloseTo(c.transform.pos.z, 3);
      expect(g.camera.pose.distance).toBeLessThanOrEqual(explore + 0.05);
      for (let i = 0; i < 200; i++) g.frame(1 / 60);
      const now = g.controlled()!;
      expect(g.camera.pose.focus.x).toBeCloseTo(now.transform.pos.x, 3);
      expect(g.camera.pose.focus.z).toBeCloseTo(now.transform.pos.z, 3);
      expect(g.camera.pose.distance).toBeLessThan(explore);
    }
  });

  it('out-of-bounds visual height is the clamped edge height, never the 99 wall', () => {
    const g = new Game();
    g.newGame('kaien');
    const t = g.map.tiles;
    expect(t.heightAt(-5, -5)).toBeGreaterThan(50);
    expect(t.visualHeightAt(-5, -5)).toBe(t.visualHeightAt(0, 0));
    expect(t.visualHeightAt(t.width + 3, t.height + 3)).toBeLessThan(10);
  });
});

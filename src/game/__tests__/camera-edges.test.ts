import { describe, expect, it } from 'vitest';
import { BALANCE } from '../content/balance';
import { Game } from '../Game';
import { clampFocusToMap, type CameraPose, forwardX, forwardZ, makePose, rightX, rightZ } from '../systems/camera/CameraRig';
/** Where the four screen corners hit the ground plane y = focus.y (independent ray cast). */
function groundCorners(pose: CameraPose, aspect: number): { x: number; z: number }[] {
  const d = pose.distance;
  const fx = forwardX(pose.yaw);
  const fz = forwardZ(pose.yaw);
  const cam = { x: pose.focus.x - fx * Math.cos(pose.pitch) * d, y: Math.sin(pose.pitch) * d, z: pose.focus.z - fz * Math.cos(pose.pitch) * d };
  // Camera basis: forward looks down at the focus.
  const f = { x: fx * Math.cos(pose.pitch), y: -Math.sin(pose.pitch), z: fz * Math.cos(pose.pitch) };
  const r = { x: rightX(pose.yaw), y: 0, z: rightZ(pose.yaw) };
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const tv = Math.tan((pose.fov * Math.PI) / 360);
  const th = tv * aspect;
  const out: { x: number; z: number }[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const dir = { x: f.x + r.x * sx * th + u.x * sy * tv, y: f.y + r.y * sx * th + u.y * sy * tv, z: f.z + r.z * sx * th + u.z * sy * tv };
      if (dir.y >= 0) continue;
      const t = -cam.y / dir.y;
      out.push({ x: cam.x + dir.x * t, z: cam.z + dir.z * t });
    }
  }
  return out;
}

describe('camera never shows past the map edge', () => {
  const W = 64;
  const H = 48;
  const m = BALANCE.camera.edgeMargin;
  const ex = BALANCE.camera.exploration;
  for (const aspect of [16 / 9, 19.5 / 9, 4 / 3]) {
    for (const [x, z] of [
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
      [W / 2, -10],
      [-10, H / 2],
    ]) {
      it(`exploration aspect ${aspect.toFixed(2)} focus (${x}, ${z})`, () => {
        const pose = makePose();
        pose.focus.x = x;
        pose.focus.z = z;
        pose.pitch = ex.pitch;
        pose.fov = ex.fov;
        pose.distance = ex.distance * BALANCE.camera.zoomOut;
        clampFocusToMap(pose, W, H, aspect, m);
        for (const c of groundCorners(pose, aspect)) {
          expect(c.x).toBeGreaterThanOrEqual(-m - 0.05);
          expect(c.x).toBeLessThanOrEqual(W + m + 0.05);
          expect(c.z).toBeGreaterThanOrEqual(-m - 0.05);
          expect(c.z).toBeLessThanOrEqual(H + m + 0.05);
        }
      });
    }
  }

  it('the zoom-out is 15 % and the encounter still zooms in', () => {
    expect(BALANCE.camera.zoomOut).toBeCloseTo(1.15);
    const g = new Game();
    g.newGame('kaien');
    for (let i = 0; i < 30; i++) g.frame(1 / 60);
    const explore = g.camera.pose.distance;
    expect(explore).toBeCloseTo(ex.distance * BALANCE.camera.zoomOut, 0);
    g.debugEncounter();
    for (let i = 0; i < 240; i++) g.frame(1 / 60);
    expect(g.camera.pose.distance).toBeLessThan(explore);
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

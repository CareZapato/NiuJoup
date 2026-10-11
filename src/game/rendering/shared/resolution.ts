import { BALANCE } from '../../content/balance';

/**
 * Resolution model (see ASSET_PIPELINE.md):
 *  - screen resolution: CSS/dp size of the window (layout, HUD, controls);
 *  - internal resolution: GL drawing buffer = screen x DPR, chosen here;
 *  - sprite resolution: texel size of the atlases (64x96 heroes), fixed;
 *  - zoom: camera distance/FOV from BALANCE.camera, independent of all three.
 * The 1920x1080 reference only informs the internal height cap; phones are
 * never forced to render 1080p.
 */
export function targetDpr(deviceDpr: number, cssHeight: number, low: boolean, factor = 1): number {
  const r = BALANCE.render;
  const cap = Math.min(deviceDpr, low ? r.maxDprLow : r.maxDprHigh);
  const h = Math.max(1, cssHeight);
  const byHeight = r.maxInternalHeight / h;
  const floor = Math.min(deviceDpr, cap, r.minInternalHeight / h);
  return Math.max(floor, Math.min(cap, byHeight) * factor, 0.5);
}

/** Lowers the DPR when the frame rate stays low, raises it back when there is headroom. */
export class AdaptiveDpr {
  private acc = 0;
  private frames = 0;
  factor = 1;

  /** Returns true when `factor` changed. */
  sample(dt: number): boolean {
    const r = BALANCE.render;
    this.acc += dt;
    this.frames++;
    if (this.acc < r.sampleSeconds) return false;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    const prev = this.factor;
    if (fps < r.downFps) this.factor = Math.max(0.5, this.factor * r.downStep);
    else if (fps > r.upFps) this.factor = Math.min(1, this.factor * r.upStep);
    return Math.abs(prev - this.factor) > 1e-3;
  }
}

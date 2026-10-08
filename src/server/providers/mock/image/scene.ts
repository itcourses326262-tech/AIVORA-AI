import 'server-only';
import type { Palette } from '../color';
import type { Noise2D } from '../noise';
import type { Rng } from '../random';
import type { SoftLight } from './lights';

/** Everything a style needs to compose its layers. */
export interface Scene {
  width: number;
  height: number;
  /** The shorter side: all sizes are fractions of it so the art scales with the canvas. */
  unit: number;
  rng: Rng;
  palette: Palette;
  noise: Noise2D;
}

/**
 * What a style contributes, from the back to the front:
 * - `lights`: big soft glows, painted onto the low-resolution colour grid;
 * - `glow`: crisp light details (stars, thin lines), an SVG fragment composited with the screen blend;
 * - `shapes`: solid forms (planets, ridges), an SVG fragment composited normally.
 * `defs` holds the gradients both fragments refer to.
 */
export interface StyleLayers {
  defs: string;
  lights: SoftLight[];
  glow: string;
  shapes: string;
}

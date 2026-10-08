import 'server-only';
import type { Rgb } from '../color';
import { samplePosition, type FlowGrid } from '../flow-field';

/** Opacity along a radius: pairs of [offset 0..1, opacity], offsets ascending. */
export type OpacityStops = readonly (readonly [number, number])[];

/** A soft round light. */
export interface DiscLight {
  kind: 'disc';
  x: number;
  y: number;
  radius: number;
  color: Rgb;
  stops: OpacityStops;
}

/** A long, soft-edged beam through (x, y), tilted `angleDeg` from vertical (clockwise). */
export interface ShaftLight {
  kind: 'shaft';
  x: number;
  y: number;
  angleDeg: number;
  width: number;
  color: Rgb;
  /** Opacity on the beam's axis; it falls off linearly to zero at half the width. */
  opacity: number;
}

export type SoftLight = DiscLight | ShaftLight;

function opacityAt(stops: OpacityStops, offset: number): number {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return 0;
  if (offset <= first[0]) return first[1];
  for (let i = 1; i < stops.length; i++) {
    const [to, toOpacity] = stops[i] as readonly [number, number];
    if (offset <= to) {
      const [from, fromOpacity] = stops[i - 1] as readonly [number, number];
      return fromOpacity + ((toOpacity - fromOpacity) * (offset - from)) / (to - from || 1);
    }
  }
  return last[1];
}

/**
 * Lights are smooth, so they are painted straight onto the low-resolution colour grid (screen
 * blend) and ride along when it is stretched to the canvas: far cheaper than rasterising huge
 * gradients at full size.
 */
export function applyLights(grid: FlowGrid, lights: readonly SoftLight[]): void {
  const { width, height, rgb, scaleX, scaleY } = grid;
  for (const light of lights) {
    const angle = light.kind === 'shaft' ? (light.angleDeg * Math.PI) / 180 : 0;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    for (let gy = 0; gy < height; gy++) {
      const dy = samplePosition(gy, scaleY) - light.y;
      for (let gx = 0; gx < width; gx++) {
        const dx = samplePosition(gx, scaleX) - light.x;
        let opacity: number;
        if (light.kind === 'disc') {
          const offset = Math.hypot(dx, dy) / light.radius;
          if (offset >= 1) continue;
          opacity = opacityAt(light.stops, offset);
        } else {
          const across = Math.abs(dx * nx + dy * ny) / (light.width / 2);
          if (across >= 1) continue;
          opacity = light.opacity * (1 - across);
        }
        if (opacity <= 0) continue;
        const o = (gy * width + gx) * 3;
        for (let ch = 0; ch < 3; ch++) {
          const below = rgb[o + ch]!;
          rgb[o + ch] = below + (opacity * light.color[ch]! * (255 - below)) / 255;
        }
      }
    }
  }
}

/** Darkens the corners toward `ink`: at the far corners `strength` of the colour is replaced. */
export function applyVignette(
  grid: FlowGrid,
  canvas: { width: number; height: number },
  ink: Rgb,
  strength: number,
): void {
  const { width, height, rgb, scaleX, scaleY } = grid;
  for (let gy = 0; gy < height; gy++) {
    const dy = samplePosition(gy, scaleY) / canvas.height - 0.5;
    for (let gx = 0; gx < width; gx++) {
      const dx = samplePosition(gx, scaleX) / canvas.width - 0.5;
      const edge = Math.min(1, Math.max(0, (Math.hypot(dx, dy) - 0.3) / 0.45));
      const mix = strength * edge * edge;
      const o = (gy * width + gx) * 3;
      for (let ch = 0; ch < 3; ch++) rgb[o + ch] = rgb[o + ch]! * (1 - mix) + ink[ch]! * mix;
    }
  }
}

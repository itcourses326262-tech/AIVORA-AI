import { describe, expect, it } from 'vitest';
import {
  FIT,
  MAX_SCALE,
  centerOf,
  clampView,
  distanceBetween,
  midpoint,
  panBy,
  pinchView,
  zoomAt,
} from '@/components/gallery/zoom';

const size = { width: 400, height: 300 };

describe('clampView', () => {
  it('returns the fitted view at scale 1 whatever the offset', () => {
    expect(clampView({ scale: 1, x: -50, y: 20 }, size)).toBe(FIT);
  });

  it('never lets the layer leave the stage', () => {
    // Scale 2: the layer is 800 x 600, so it can move 400 / 300 pixels at most.
    expect(clampView({ scale: 2, x: 30, y: 30 }, size)).toEqual({ scale: 2, x: 0, y: 0 });
    expect(clampView({ scale: 2, x: -999, y: -999 }, size)).toEqual({ scale: 2, x: -400, y: -300 });
    expect(clampView({ scale: 2, x: -120, y: -80 }, size)).toEqual({ scale: 2, x: -120, y: -80 });
  });

  it('keeps the scale between 1 and the maximum, and survives garbage', () => {
    expect(clampView({ scale: 99, x: 0, y: 0 }, size).scale).toBe(MAX_SCALE);
    expect(clampView({ scale: 0.2, x: 0, y: 0 }, size)).toBe(FIT);
    expect(clampView({ scale: Number.NaN, x: 0, y: 0 }, size)).toBe(FIT);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the pointer where it is', () => {
    const focal = { x: 100, y: 60 };
    const view = zoomAt(FIT, size, 2, focal);
    // The layer point that was under the pointer, now scaled, is still under it.
    const layerX = (focal.x - view.x) / view.scale;
    const layerY = (focal.y - view.y) / view.scale;
    expect(layerX).toBeCloseTo(100);
    expect(layerY).toBeCloseTo(60);
  });

  it('zooms toward the middle when asked to', () => {
    const view = zoomAt(FIT, size, 2, centerOf(size));
    expect(view).toEqual({ scale: 2, x: -200, y: -150 });
  });

  it('returns to the fitted view when zooming out to 1', () => {
    expect(zoomAt({ scale: 3, x: -100, y: -80 }, size, 1, centerOf(size))).toBe(FIT);
  });
});

describe('panBy', () => {
  it('moves a zoomed view and stops at the edges', () => {
    const zoomed = { scale: 2, x: -100, y: -100 };
    expect(panBy(zoomed, size, -50, 20)).toEqual({ scale: 2, x: -150, y: -80 });
    expect(panBy(zoomed, size, 1000, 1000)).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it('does nothing to a fitted view', () => {
    expect(panBy(FIT, size, 50, 50)).toBe(FIT);
  });
});

describe('pinchView', () => {
  it('scales by how much the fingers moved apart and follows their midpoint', () => {
    const start = { view: FIT, center: { x: 200, y: 150 }, distance: 100 };
    const view = pinchView(start, { center: { x: 200, y: 150 }, distance: 200 }, size);
    expect(view.scale).toBe(2);
    expect(view).toEqual({ scale: 2, x: -200, y: -150 });
  });

  it('ignores a pinch that started with the fingers on top of each other', () => {
    const start = { view: FIT, center: { x: 0, y: 0 }, distance: 0 };
    expect(pinchView(start, { center: { x: 5, y: 5 }, distance: 50 }, size)).toBe(FIT);
  });
});

describe('geometry helpers', () => {
  it('measures a distance and a midpoint', () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpoint({ x: 0, y: 10 }, { x: 10, y: 30 })).toEqual({ x: 5, y: 20 });
  });
});

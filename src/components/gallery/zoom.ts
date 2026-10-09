/**
 * The arithmetic of zooming and panning a picture. The picture sits in a layer exactly as large as
 * its stage (the browser fits it inside with `object-fit: contain`), and the layer is moved with
 * `translate(x, y) scale(scale)` from its top-left corner. Zooming keeps the point under the
 * pointer (or between two fingers) where it is, and panning never shows anything beyond the layer.
 */

export interface View {
  scale: number;
  /** Translation of the layer in stage pixels (zero or negative once zoomed in). */
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const FIT: View = { scale: 1, x: 0, y: 0 };
export const MAX_SCALE = 6;
/** What one press of the + or - button, or one key press, multiplies the zoom by. */
export const ZOOM_STEP = 1.5;
/** Where a double click or double tap zooms to. */
export const DOUBLE_TAP_SCALE = 2.5;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(1, Number.isFinite(scale) ? scale : 1));
}

/** Pulls a view back to where it is allowed to be: scale 1 to {@link MAX_SCALE}, layer covering the stage. */
export function clampView(view: View, size: Size): View {
  const scale = clampScale(view.scale);
  if (scale === 1) return FIT;
  const minX = size.width - size.width * scale;
  const minY = size.height - size.height * scale;
  return {
    scale,
    x: Math.min(0, Math.max(minX, view.x)),
    y: Math.min(0, Math.max(minY, view.y)),
  };
}

/** Changes the zoom to `scale` keeping the layer point under `focal` (stage pixels) in place. */
export function zoomAt(view: View, size: Size, scale: number, focal: Point): View {
  const next = clampScale(scale);
  const ratio = next / view.scale;
  return clampView(
    {
      scale: next,
      x: focal.x - (focal.x - view.x) * ratio,
      y: focal.y - (focal.y - view.y) * ratio,
    },
    size,
  );
}

export function panBy(view: View, size: Size, dx: number, dy: number): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, size);
}

/** The middle of the stage: where the zoom buttons and keys aim. */
export function centerOf(size: Size): Point {
  return { x: size.width / 2, y: size.height / 2 };
}

export interface PinchStart {
  view: View;
  center: Point;
  distance: number;
}

/**
 * Two fingers: the zoom follows how far apart they are and the layer follows their midpoint, so
 * the part of the picture between the fingers stays between the fingers.
 */
export function pinchView(
  start: PinchStart,
  current: { center: Point; distance: number },
  size: Size,
): View {
  if (!(start.distance > 0)) return start.view;
  const scale = clampScale((start.view.scale * current.distance) / start.distance);
  // The layer point under the starting midpoint, carried to the current midpoint.
  const anchorX = (start.center.x - start.view.x) / start.view.scale;
  const anchorY = (start.center.y - start.view.y) / start.view.scale;
  return clampView(
    { scale, x: current.center.x - anchorX * scale, y: current.center.y - anchorY * scale },
    size,
  );
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

import 'server-only';
import { toHex, type Rgb } from '../color';

/** Numbers in SVG attributes: two decimals are plenty at megapixel scale and keep strings short. */
export const fmt = (value: number): string => String(Math.round(value * 100) / 100);

export interface Stop {
  offset: number;
  color: Rgb;
  opacity: number;
}

function stops(list: readonly Stop[]): string {
  return list
    .map(
      (stop) =>
        `<stop offset="${fmt(stop.offset)}" stop-color="${toHex(stop.color)}" stop-opacity="${fmt(stop.opacity)}"/>`,
    )
    .join('');
}

/** A radial gradient in object-bounding-box units, optionally with an off-centre focal point. */
export function radial(
  id: string,
  list: readonly Stop[],
  focus?: { x: number; y: number },
): string {
  const focal = focus ? ` fx="${fmt(focus.x)}" fy="${fmt(focus.y)}"` : '';
  return `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5"${focal}>${stops(list)}</radialGradient>`;
}

/** A linear gradient between two points in user space (pixels). */
export function linear(
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  list: readonly Stop[],
): string {
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(from.x)}" y1="${fmt(from.y)}" x2="${fmt(to.x)}" y2="${fmt(to.y)}">${stops(list)}</linearGradient>`;
}

/** A circle filled with a gradient (by id) whose box is exactly the circle, so radial stops map to its radius. */
export function disc(cx: number, cy: number, radius: number, fillId: string, opacity = 1): string {
  return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(radius)}" fill="url(#${fillId})" opacity="${fmt(opacity)}"/>`;
}

export function svgDocument(width: number, height: number, defs: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs}</defs>${body}</svg>`;
}

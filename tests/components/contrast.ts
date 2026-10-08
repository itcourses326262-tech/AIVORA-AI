// WCAG 2.x relative luminance and contrast ratio, for the token tests and the real-browser checks.

export type Rgba = [number, number, number, number];

/** Parses `#rrggbb`, `rgb(r g b / a)` (the stylesheet's spelling) and `rgb(r, g, b)` / `rgba(r, g, b, a)` (what a browser reports). */
export function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?\)$/.exec(value);
  if (rgb)
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]),
    ];
  throw new Error(`cannot parse colour: ${value}`);
}

/** `top` painted over an opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + bottom[i]! * (1 - a)).concat(1) as Rgba;
}

export function luminance([r, g, b]: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}

export function contrast(foreground: Rgba, background: Rgba): number {
  const [hi, lo] = [luminance(over(foreground, background)), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (hi! + 0.05) / (lo! + 0.05);
}

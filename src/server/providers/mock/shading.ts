import 'server-only';

/**
 * Per-pixel brightness multipliers that darken the corners: 1 in the middle, `1 - strength` at the
 * far corners. Computed once per image or clip.
 */
export function vignetteFactors(width: number, height: number, strength: number): Float32Array {
  const factors = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const dy = (y + 0.5) / height - 0.5;
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5) / width - 0.5;
      const edge = Math.min(1, Math.max(0, (Math.hypot(dx, dy) - 0.3) / 0.45));
      factors[y * width + x] = 1 - strength * edge * edge;
    }
  }
  return factors;
}

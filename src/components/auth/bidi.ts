const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);

/**
 * Keeps a left-to-right value (an email address) from reordering the Arabic sentence it sits in:
 * the Unicode isolates give it its own direction and leave the surrounding text alone.
 */
export function isolateLtr(value: string): string {
  return `${LRI}${value}${PDI}`;
}

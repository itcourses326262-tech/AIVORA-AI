import 'server-only';

/** Dotted-quad IPv4 as an unsigned 32-bit number, or null when it is not one. */
export function parseIpv4(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = result * 256 + octet;
  }
  return result;
}

/** Eight 16-bit groups of an IPv6 address, or null. Handles `::` and a dotted IPv4 tail. */
export function parseIpv6(value: string): number[] | null {
  let text = value.toLowerCase();
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail?.[1]) {
    const v4 = parseIpv4(tail[1]);
    if (v4 === null) return null;
    text = `${text.slice(0, -tail[1].length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string | undefined): number[] | null => {
    if (!part) return [];
    const groups = part
      .split(':')
      .map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : -1));
    return groups.every((group) => group >= 0) ? groups : null;
  };
  const head = parse(halves[0]);
  const rest = parse(halves[1]);
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

/** The IPv4 address inside an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`), or null. */
export function ipv4FromMapped(groups: readonly number[]): string | null {
  const isMapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (!isMapped) return null;
  const [high = 0, low = 0] = groups.slice(6);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

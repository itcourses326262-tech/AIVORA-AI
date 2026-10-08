/** True when `element` sits in a right-to-left context (nearest `[dir]` ancestor, else `<html>`). */
export function isRtl(element: Element | null | undefined): boolean {
  const direction = element?.closest('[dir]')?.getAttribute('dir') ?? document.documentElement.dir;
  return direction === 'rtl';
}

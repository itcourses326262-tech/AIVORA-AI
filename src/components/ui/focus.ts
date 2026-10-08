import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[tabindex]',
  '[contenteditable="true"]',
  'audio[controls]',
  'video[controls]',
].join(',');

/** True when neither `node` nor an ancestor up to `container` is `display: none` (results are cached per call). */
function isDisplayed(
  node: HTMLElement | null,
  container: HTMLElement,
  cache: Map<HTMLElement, boolean>,
): boolean {
  if (!node) return true;
  const known = cache.get(node);
  if (known !== undefined) return known;
  const shown =
    getComputedStyle(node).display !== 'none' &&
    (node === container || isDisplayed(node.parentElement, container, cache));
  cache.set(node, shown);
  return shown;
}

/**
 * Tabbable descendants of `container` in DOM order. Skips what the browser skips: disabled
 * controls, `tabindex="-1"`, inert / `hidden` / `aria-hidden` subtrees and anything the CSS hides
 * (`display: none`, `visibility: hidden`, e.g. a `hidden sm:inline-flex` action), so a hidden
 * first or last control cannot break the wrap-around of a focus trap.
 */
export function getTabbable(container: HTMLElement): HTMLElement[] {
  const displayed = new Map<HTMLElement, boolean>();
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    if (element.matches(':disabled') || element.tabIndex < 0) return false;
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const { visibility } = getComputedStyle(element);
    if (visibility === 'hidden' || visibility === 'collapse') return false;
    return isDisplayed(element, container, displayed);
  });
}

/** Wraps Tab / Shift+Tab inside `container`. Returns true when it handled the event. */
export function trapTab(
  event: KeyboardEvent | ReactKeyboardEvent,
  container: HTMLElement,
): boolean {
  if (event.key !== 'Tab') return false;
  const tabbable = getTabbable(container);
  const first = tabbable[0];
  const last = tabbable[tabbable.length - 1];
  if (!first || !last) {
    event.preventDefault();
    container.focus();
    return true;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

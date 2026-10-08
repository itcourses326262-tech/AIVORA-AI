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

/** Tabbable descendants of `container` in DOM order (skips disabled, hidden and inert subtrees). */
export function getTabbable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    if (element.matches(':disabled') || element.tabIndex < 0) return false;
    return !element.closest('[hidden], [inert], [aria-hidden="true"]');
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

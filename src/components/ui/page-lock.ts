let scrollLocks = 0;
let restoreScroll: (() => void) | undefined;

/** Stops the page behind a modal from scrolling; reference counted so nested modals compose. */
export function lockPageScroll(): () => void {
  if (scrollLocks === 0) {
    const root = document.documentElement;
    const body = document.body;
    const gutter = window.innerWidth - root.clientWidth;
    const previousOverflow = root.style.overflow;
    const previousPadding = body.style.paddingInlineEnd;
    root.style.overflow = 'hidden';
    // Replace the vanished scrollbar so the layout behind the modal does not jump.
    if (gutter > 0) body.style.paddingInlineEnd = `${gutter}px`;
    restoreScroll = () => {
      root.style.overflow = previousOverflow;
      body.style.paddingInlineEnd = previousPadding;
    };
  }
  scrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks -= 1;
    if (scrollLocks === 0) {
      restoreScroll?.();
      restoreScroll = undefined;
    }
  };
}

/**
 * Marks everything in `<body>` except `keep` (and anything flagged `data-inert-exempt`, such as the
 * toast region) as inert, so assistive technology and Tab cannot leave an open modal.
 */
export function inertBackground(keep: HTMLElement): () => void {
  const changed: Element[] = [];
  for (const child of Array.from(document.body.children)) {
    if (child === keep || child.contains(keep) || child.hasAttribute('inert')) continue;
    if (child.hasAttribute('data-inert-exempt') || child.tagName === 'SCRIPT') continue;
    child.setAttribute('inert', '');
    changed.push(child);
  }
  return () => {
    for (const child of changed) child.removeAttribute('inert');
  };
}

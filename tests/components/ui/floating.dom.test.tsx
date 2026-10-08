import { describe, expect, it } from 'vitest';
import { placeFloating } from '@/components/ui/floating';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function setup({ dir, anchor }: { dir: 'ltr' | 'rtl'; anchor: DOMRect }) {
  document.body.innerHTML = '';
  document.documentElement.dir = dir;
  const anchorEl = document.createElement('button');
  const floatingEl = document.createElement('div');
  document.body.append(anchorEl, floatingEl);
  anchorEl.getBoundingClientRect = () => anchor;
  Object.defineProperty(floatingEl, 'offsetWidth', { value: 200, configurable: true });
  Object.defineProperty(floatingEl, 'offsetHeight', { value: 100, configurable: true });
  Object.defineProperty(document.documentElement, 'clientWidth', {
    value: 1000,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    value: 800,
    configurable: true,
  });
  return { anchorEl, floatingEl };
}

describe('placeFloating', () => {
  it('opens below the anchor, lined up with its inline start (left in LTR)', () => {
    const { anchorEl, floatingEl } = setup({ dir: 'ltr', anchor: rect(300, 100, 80, 40) });
    placeFloating(anchorEl, floatingEl, { side: 'bottom', align: 'start', offset: 6 });
    expect(floatingEl.style.left).toBe('300px');
    expect(floatingEl.style.top).toBe('146px');
    expect(floatingEl.dataset.side).toBe('bottom');
  });

  it('lines up with the inline start on the right in RTL', () => {
    const { anchorEl, floatingEl } = setup({ dir: 'rtl', anchor: rect(300, 100, 80, 40) });
    placeFloating(anchorEl, floatingEl, { side: 'bottom', align: 'start', offset: 6 });
    // The right edges meet: 380 - 200.
    expect(floatingEl.style.left).toBe('180px');
  });

  it('align end is the opposite edge in each direction', () => {
    const ltr = setup({ dir: 'ltr', anchor: rect(300, 100, 80, 40) });
    placeFloating(ltr.anchorEl, ltr.floatingEl, { side: 'bottom', align: 'end', offset: 6 });
    expect(ltr.floatingEl.style.left).toBe('180px');
    const rtl = setup({ dir: 'rtl', anchor: rect(300, 100, 80, 40) });
    placeFloating(rtl.anchorEl, rtl.floatingEl, { side: 'bottom', align: 'end', offset: 6 });
    expect(rtl.floatingEl.style.left).toBe('300px');
  });

  it('puts an inline-start side tooltip on the right of the anchor in RTL', () => {
    const { anchorEl, floatingEl } = setup({ dir: 'rtl', anchor: rect(400, 100, 40, 40) });
    placeFloating(anchorEl, floatingEl, { side: 'start', align: 'center', offset: 8 });
    expect(floatingEl.dataset.side).toBe('right');
    expect(floatingEl.style.left).toBe('448px');
    const ltr = setup({ dir: 'ltr', anchor: rect(400, 100, 40, 40) });
    placeFloating(ltr.anchorEl, ltr.floatingEl, { side: 'start', align: 'center', offset: 8 });
    expect(ltr.floatingEl.dataset.side).toBe('left');
    expect(ltr.floatingEl.style.left).toBe('192px');
  });

  it('flips to the other side when the preferred one has no room', () => {
    const { anchorEl, floatingEl } = setup({ dir: 'ltr', anchor: rect(300, 740, 80, 40) });
    const used = placeFloating(anchorEl, floatingEl, { side: 'bottom', align: 'start', offset: 6 });
    expect(used).toBe('top');
    expect(floatingEl.style.top).toBe('634px');
  });

  it('stays inside the viewport horizontally', () => {
    const { anchorEl, floatingEl } = setup({ dir: 'ltr', anchor: rect(940, 100, 50, 40) });
    placeFloating(anchorEl, floatingEl, { side: 'bottom', align: 'start', offset: 6 });
    expect(floatingEl.style.left).toBe('792px'); // 1000 - 200 - 8
  });

  it('caps the height to the room it has when it fits on neither side', () => {
    const { anchorEl, floatingEl } = setup({ dir: 'ltr', anchor: rect(300, 30, 80, 40) });
    Object.defineProperty(floatingEl, 'offsetHeight', { value: 900, configurable: true });
    placeFloating(anchorEl, floatingEl, { side: 'bottom', align: 'start', offset: 6 });
    expect(floatingEl.style.maxHeight).toBe('716px'); // 800 - 70 - 6 - 8
  });

  it('can match the anchor width', () => {
    const { anchorEl, floatingEl } = setup({ dir: 'ltr', anchor: rect(300, 100, 260, 40) });
    placeFloating(anchorEl, floatingEl, {
      side: 'bottom',
      align: 'start',
      offset: 6,
      matchWidth: true,
    });
    expect(floatingEl.style.minWidth).toBe('260px');
  });
});

import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { getTabbable, trapTab } from '@/components/ui/focus';

function panel(children: ReactNode): HTMLElement {
  const { container } = render(<div tabIndex={-1}>{children}</div>);
  return container.firstElementChild as HTMLElement;
}

const ids = (elements: HTMLElement[]) => elements.map((element) => element.id);

function tab(container: HTMLElement, { shift = false } = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, cancelable: true });
  const wrapped = trapTab(event, container);
  return { wrapped, prevented: event.defaultPrevented };
}

describe('getTabbable', () => {
  it('lists links, buttons, fields and explicit tab stops in DOM order', () => {
    const root = panel(
      <>
        <a id="link" href="/x">
          x
        </a>
        <button id="button">b</button>
        <input id="input" />
        <input id="hidden-input" type="hidden" />
        <select id="select" />
        <textarea id="textarea" />
        <div id="stop" tabIndex={0} />
      </>,
    );
    expect(ids(getTabbable(root))).toEqual([
      'link',
      'button',
      'input',
      'select',
      'textarea',
      'stop',
    ]);
  });

  it('skips what the browser skips: disabled, tabindex -1, hidden, inert and aria-hidden subtrees', () => {
    const root = panel(
      <>
        <button id="ok">ok</button>
        <button id="disabled" disabled>
          d
        </button>
        <button id="negative" tabIndex={-1}>
          n
        </button>
        <div hidden>
          <button id="in-hidden">h</button>
        </div>
        <div inert>
          <button id="in-inert">i</button>
        </div>
        <div aria-hidden="true">
          <button id="in-aria-hidden">a</button>
        </div>
      </>,
    );
    expect(ids(getTabbable(root))).toEqual(['ok']);
  });

  it('skips controls the CSS hides: display none on the control or on an ancestor', () => {
    const root = panel(
      <>
        <button id="shown">s</button>
        <button id="none" style={{ display: 'none' }}>
          n
        </button>
        <div style={{ display: 'none' }}>
          <div>
            <button id="deep">d</button>
          </div>
        </div>
        <div style={{ display: 'contents' }}>
          <button id="contents">c</button>
        </div>
      </>,
    );
    expect(ids(getTabbable(root))).toEqual(['shown', 'contents']);
  });

  it('skips visibility hidden, also when inherited, but not a child that shows itself again', () => {
    const root = panel(
      <>
        <button id="shown">s</button>
        <button id="invisible" style={{ visibility: 'hidden' }}>
          i
        </button>
        <div style={{ visibility: 'hidden' }}>
          <button id="inherited">i</button>
          <button id="override" style={{ visibility: 'visible' }}>
            o
          </button>
        </div>
      </>,
    );
    expect(ids(getTabbable(root))).toEqual(['shown', 'override']);
  });

  it('does not look above the container: a hidden page around it does not matter', () => {
    const { container } = render(
      <div style={{ display: 'none' }}>
        <div id="inner">
          <button id="b">b</button>
        </div>
      </div>,
    );
    // jsdom has no layout; the point is only that the walk stops at the container.
    expect(ids(getTabbable(container.querySelector('#inner') as HTMLElement))).toEqual(['b']);
  });
});

describe('trapTab', () => {
  it('wraps forward from the last visible control when the last in the DOM is hidden', () => {
    const root = panel(
      <>
        <button id="a">a</button>
        <button id="b">b</button>
        <button id="c" style={{ display: 'none' }}>
          c
        </button>
      </>,
    );
    root.querySelector<HTMLElement>('#b')?.focus();
    expect(tab(root)).toEqual({ wrapped: true, prevented: true });
    expect(document.activeElement?.id).toBe('a');
  });

  it('wraps backward from the first visible control when the first in the DOM is hidden', () => {
    const root = panel(
      <>
        <button id="a" style={{ visibility: 'hidden' }}>
          a
        </button>
        <button id="b">b</button>
        <button id="c">c</button>
      </>,
    );
    root.querySelector<HTMLElement>('#b')?.focus();
    expect(tab(root, { shift: true })).toEqual({ wrapped: true, prevented: true });
    expect(document.activeElement?.id).toBe('c');
  });

  it('leaves Tab alone in the middle and keeps focus on the container when nothing is tabbable', () => {
    const root = panel(
      <>
        <button id="a">a</button>
        <button id="b">b</button>
        <button id="c">c</button>
      </>,
    );
    root.querySelector<HTMLElement>('#a')?.focus();
    expect(tab(root)).toEqual({ wrapped: false, prevented: false });

    const empty = panel(<button style={{ display: 'none' }}>x</button>);
    expect(tab(empty)).toEqual({ wrapped: true, prevented: true });
    expect(document.activeElement).toBe(empty);
  });

  it('ignores every other key', () => {
    const root = panel(<button>a</button>);
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    expect(trapTab(event, root)).toBe(false);
  });
});

import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentSection, DocsNav, type DocsNavNode } from '@/components/docs/docs-nav';
import { axeViolations } from '../axe';
import { renderUi } from '../render';

const NODES: DocsNavNode[] = [
  { id: 'intro', label: 'Introduction' },
  { id: 'quickstart', label: 'Quickstart' },
  {
    id: 'reference',
    label: 'Endpoint reference',
    children: [
      {
        id: 'ref-generations',
        label: 'Generations',
        children: [
          { id: 'op-create', label: 'Create a generation', badge: 'POST' },
          { id: 'op-get', label: 'Get a generation', badge: 'GET' },
        ],
      },
    ],
  },
];
const IDS = ['intro', 'quickstart', 'reference', 'ref-generations', 'op-create', 'op-get'];

/** Anchors the page would have, with a `top` the test moves around like a scroll would. */
const tops = new Map<string, number>();
function mountAnchors() {
  for (const id of IDS) {
    const element = document.createElement('section');
    element.id = id;
    document.body.append(element);
  }
}
function scrollTo(position: Record<string, number>) {
  tops.clear();
  for (const [id, top] of Object.entries(position)) tops.set(id, top);
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

beforeEach(() => {
  mountAnchors();
  // A frame that runs at once; its id is 0 ("none pending") so the next scroll schedules again.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const top = tops.get(this.id) ?? 5000;
    return {
      top,
      bottom: top + 300,
      left: 0,
      right: 0,
      width: 0,
      height: 300,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  });
  tops.clear();
  for (const [index, id] of IDS.entries()) tops.set(id, index * 400 + 60);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const current = () => document.querySelectorAll('[aria-current="location"]');

describe('currentSection', () => {
  it('is the last anchor that has passed the reading line', () => {
    tops.clear();
    tops.set('intro', -900);
    tops.set('quickstart', -100);
    tops.set('reference', 300);
    expect(currentSection(['intro', 'quickstart', 'reference'])).toBe('quickstart');
    expect(currentSection(['intro', 'quickstart', 'reference'], 400)).toBe('reference');
  });

  it('falls back to the first anchor before any has been reached', () => {
    tops.clear();
    tops.set('intro', 800);
    tops.set('quickstart', 1200);
    expect(currentSection(['intro', 'quickstart'])).toBe('intro');
  });

  it('ignores anchors that are not on the page', () => {
    document.getElementById('intro')?.remove();
    tops.clear();
    tops.set('quickstart', 10);
    expect(currentSection(['intro', 'quickstart'])).toBe('quickstart');
  });
});

describe('DocsNav', () => {
  it('lists every section as a link to its anchor, endpoints with their method', () => {
    renderUi(<DocsNav nodes={NODES} title="On this page" />);
    const sidebar = screen.getAllByRole('navigation', { name: 'On this page' }).at(-1);
    const links = within(sidebar as HTMLElement).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(IDS.map((id) => `#${id}`));
    expect(
      within(sidebar as HTMLElement).getByRole('link', { name: /Create a generation/ }),
    ).toHaveTextContent('POST');
  });

  it('highlights the section being read, the endpoint rather than its group', () => {
    renderUi(<DocsNav nodes={NODES} title="On this page" />);
    scrollTo({
      intro: -1500,
      quickstart: -1100,
      reference: -700,
      'ref-generations': -300,
      'op-create': 100,
      'op-get': 900,
    });
    const marked = [...current()].map((link) => link.getAttribute('href'));
    // One highlight in the sidebar and one in the mobile list, both on the endpoint.
    expect(marked).toEqual(['#op-create', '#op-create']);
  });

  it('follows the scroll in both directions', () => {
    renderUi(<DocsNav nodes={NODES} title="On this page" />);
    scrollTo({
      intro: 0,
      quickstart: 500,
      reference: 900,
      'ref-generations': 1300,
      'op-create': 1500,
      'op-get': 2000,
    });
    expect([...current()].map((link) => link.getAttribute('href'))[0]).toBe('#intro');
    scrollTo({
      intro: -1500,
      quickstart: -900,
      reference: -300,
      'ref-generations': 100,
      'op-create': 300,
      'op-get': 800,
    });
    expect([...current()].map((link) => link.getAttribute('href'))[0]).toBe('#ref-generations');
  });

  it('opens the same list from a bar on small screens, naming the current section', async () => {
    const user = userEvent.setup();
    renderUi(<DocsNav nodes={NODES} title="On this page" />);
    const toggle = screen.getByRole('button', { name: /On this page/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Introduction');
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(panel).toHaveAttribute('hidden');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('hidden');
  });

  it('closes the list after a choice and on Escape', async () => {
    const user = userEvent.setup();
    renderUi(<DocsNav nodes={NODES} title="On this page" />);
    const toggle = screen.getByRole('button', { name: /On this page/ });
    const panel = document.getElementById(
      toggle.getAttribute('aria-controls') ?? '',
    ) as HTMLElement;

    await user.click(toggle);
    await user.click(within(panel).getByRole('link', { name: 'Quickstart' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('puts the current section in the bar as the page moves', () => {
    renderUi(<DocsNav nodes={NODES} title="On this page" />);
    scrollTo({
      intro: -1500,
      quickstart: 50,
      reference: 800,
      'ref-generations': 1200,
      'op-create': 1400,
      'op-get': 1800,
    });
    expect(screen.getByRole('button', { name: /On this page/ })).toHaveTextContent('Quickstart');
  });

  it('has no accessibility violations, in either language', async () => {
    const { container, unmount } = renderUi(<DocsNav nodes={NODES} title="On this page" />);
    expect(await axeViolations(container)).toEqual([]);
    unmount();
    const arabic = renderUi(<DocsNav nodes={NODES} title="في هذه الصفحة" />, { locale: 'ar' });
    expect(await axeViolations(arabic.container)).toEqual([]);
  });
});

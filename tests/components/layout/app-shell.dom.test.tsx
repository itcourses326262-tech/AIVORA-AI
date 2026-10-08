import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/layout/app-shell';
import type { CurrentUser } from '@/lib/user-context';
import { renderUi } from '../render';

const nav = vi.hoisted(() => ({ pathname: '/studio' }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => nav.pathname,
}));

const LAYLA: CurrentUser = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla Hassan',
  role: 'user',
  locale: 'en',
  creditBalance: 1250,
};

afterEach(() => {
  nav.pathname = '/studio';
  document.cookie = 'aivore_sidebar=; Max-Age=0; Path=/';
});

function mount(props: { collapsed?: boolean; locale?: 'ar' | 'en' } = {}) {
  return renderUi(
    <AppShell initialUser={LAYLA} defaultCollapsed={props.collapsed}>
      <h1>Page content</h1>
    </AppShell>,
    { locale: props.locale },
  );
}

describe('AppShell', () => {
  it('renders exactly one <main id="main-content"> holding the page', () => {
    const { container } = mount();
    const mains = container.ownerDocument.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'main-content');
    expect(
      within(mains[0] as HTMLElement).getByRole('heading', { name: 'Page content' }),
    ).toBeInTheDocument();
  });

  it('has the five destinations in the sidebar and in the mobile tab bar', () => {
    mount();
    const sidebar = screen.getByRole('navigation', { name: 'App navigation' });
    const tabs = screen.getByRole('navigation', { name: 'Mobile navigation' });
    for (const group of [sidebar, tabs]) {
      const hrefs = within(group)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
        .filter((href) => href !== '/');
      expect(hrefs).toEqual(['/studio', '/gallery', '/explore', '/account', '/docs']);
    }
    // The tab bar uses the short label for API docs so five tabs fit in 360px ("Docs" instead of "API docs").
    expect(within(tabs).getByRole('link', { name: 'Docs' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'API docs' })).toBeInTheDocument();
  });

  it('marks the current page, and keeps a section lit on its sub-pages', () => {
    nav.pathname = '/gallery/gen_01hx';
    mount();
    for (const name of ['App navigation', 'Mobile navigation']) {
      const group = screen.getByRole('navigation', { name });
      const current = within(group).getAllByRole('link', { current: 'page' });
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveAttribute('href', '/gallery');
    }
  });

  it('does not light Studio on a path that merely starts with the same letters', () => {
    nav.pathname = '/studio-pro';
    mount();
    expect(screen.queryAllByRole('link', { current: 'page' })).toHaveLength(0);
  });

  it('shows the live balance and the account menu in the top bar', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Credits: 1,250' })).toHaveAttribute(
      'href',
      '/account',
    );
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
  });

  it('collapses the sidebar, remembers it in a cookie and keeps links named by aria-label', async () => {
    const user = userEvent.setup();
    mount();
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(document.cookie).toContain('aivore_sidebar=collapsed');
    const sidebar = screen.getByRole('navigation', { name: 'App navigation' });
    const studio = within(sidebar).getByRole('link', { name: 'Studio' });
    expect(studio).toHaveAttribute('aria-label', 'Studio');
    expect(studio).not.toHaveTextContent('Studio');
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(document.cookie).toContain('aivore_sidebar=expanded');
    expect(within(sidebar).getByRole('link', { name: 'Studio' })).toHaveTextContent('Studio');
  });

  it('starts collapsed when the server read the cookie', () => {
    mount({ collapsed: true });
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(document.querySelector('aside')).toHaveAttribute('data-collapsed', 'true');
  });

  it('flags the shell so toasts can sit above the mobile tab bar', () => {
    mount();
    expect(document.querySelector('[data-app-shell]')).toBeInTheDocument();
  });

  it('is localized and mirrored: Arabic labels, and the page direction comes from <html dir>', () => {
    mount({ locale: 'ar' });
    expect(document.documentElement.dir).toBe('rtl');
    const sidebar = screen.getByRole('navigation', { name: 'التنقل داخل التطبيق' });
    expect(within(sidebar).getByRole('link', { name: 'الاستوديو' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'معرضي' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'الرصيد: ١٬٢٥٠' })).toBeInTheDocument();
    // Only logical properties: nothing is positioned with left/right classes.
    const classes = Array.from(document.querySelectorAll('[class]')).map(
      (node) => node.getAttribute('class') ?? '',
    );
    expect(
      classes.filter((value) =>
        /(?:^|\s)(?:left|right|ml|mr|pl|pr|text-left|text-right)-/.test(value),
      ),
    ).toEqual([]);
  });
});

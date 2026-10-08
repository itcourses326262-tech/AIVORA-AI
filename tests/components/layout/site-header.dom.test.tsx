import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteHeader } from '@/components/layout/site-header';
import { UserProvider, type CurrentUser } from '@/lib/user-context';
import { renderUi } from '../render';

const nav = vi.hoisted(() => ({ pathname: '/' }));
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
  creditBalance: 50,
};

function mount(user: CurrentUser | null, locale: 'ar' | 'en' = 'en') {
  return renderUi(
    <UserProvider initialUser={user}>
      <SiteHeader />
    </UserProvider>,
    { locale },
  );
}

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
});

afterEach(() => {
  nav.pathname = '/';
  document.documentElement.removeAttribute('data-theme');
  window.scrollTo = () => {};
});

describe('SiteHeader', () => {
  it('links the logo home and offers the main navigation', () => {
    mount(null);
    expect(screen.getByRole('link', { name: 'AIVORE home' })).toHaveAttribute('href', '/');
    const main = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(
      within(main)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/studio', '/explore', '/docs']);
  });

  it('marks the current section', () => {
    nav.pathname = '/explore';
    mount(null);
    const main = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(main).getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(main).getByRole('link', { name: 'Studio' })).not.toHaveAttribute('aria-current');
  });

  it('shows log in and sign up to a visitor, and no account menu', () => {
    mount(null);
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register');
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
  });

  it('shows credits and the account menu to a signed-in user, and no sign-up button', () => {
    mount(LAYLA);
    expect(screen.getByRole('link', { name: 'Credits: 50' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument();
  });

  it('has the language and theme switchers next to the navigation', () => {
    mount(null);
    expect(screen.getByRole('button', { name: 'Language: English' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Theme' })).toBeInTheDocument();
  });

  it('opens the mobile menu as a modal sheet with navigation, preferences and the visitor buttons', async () => {
    const user = userEvent.setup();
    mount(null);
    const button = screen.getByRole('button', { name: 'Open menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    const sheet = screen.getByRole('dialog', { name: 'Mobile navigation' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(within(sheet).getByRole('link', { name: 'Studio' })).toBeInTheDocument();
    expect(within(sheet).getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    expect(within(sheet).getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(within(sheet).getByRole('radio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(sheet).getByRole('link', { name: 'Sign up' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Log in' })).toBeInTheDocument();
  });

  it('closes the mobile menu on Escape and when a link is chosen, returning focus to the button', async () => {
    const user = userEvent.setup();
    mount(null);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Explore' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('has no sign-in buttons in the mobile menu for a signed-in user', async () => {
    const user = userEvent.setup();
    mount(LAYLA);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument();
  });

  it('keeps the sheet menu until lg and never lets the brand or the call to action shrink', () => {
    // The Arabic labels do not fit one row on a portrait tablet (768-860px), so the inline
    // navigation starts at lg. (site-header.layout.test.tsx measures it in a real browser.)
    mount(null, 'ar');
    const main = screen.getByRole('navigation', { name: 'التنقل الرئيسي' });
    expect(main).toHaveClass('hidden', 'lg:flex');
    expect(screen.getByRole('button', { name: 'فتح القائمة' })).toHaveClass('lg:hidden');
    expect(screen.getByRole('link', { name: 'تسجيل الدخول' })).toHaveClass(
      'hidden',
      'lg:inline-flex',
    );
    for (const link of within(main).getAllByRole('link'))
      expect(link).toHaveClass('whitespace-nowrap');
    expect(screen.getByRole('link', { name: 'الصفحة الرئيسية لـ AIVORE' })).toHaveClass('shrink-0');
    expect(screen.getByRole('link', { name: 'إنشاء حساب' })).toHaveClass(
      'shrink-0',
      'whitespace-nowrap',
    );
    expect(document.body.innerHTML).not.toMatch(/(?:^|[\s"'])md:(?:flex|hidden|inline-flex)/);
  });

  it('is localized and uses an Arabic-first reading order', () => {
    mount(null, 'ar');
    expect(screen.getByRole('navigation', { name: 'التنقل الرئيسي' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'تسجيل الدخول' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'إنشاء حساب' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'فتح القائمة' })).toBeInTheDocument();
  });
});

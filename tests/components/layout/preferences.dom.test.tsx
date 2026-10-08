import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { renderUi } from '../render';

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/',
}));

const expire = (name: string) => {
  document.cookie = `${name}=; Max-Age=0; Path=/`;
};

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
});

afterEach(() => {
  expire('aivore_locale');
  expire('aivore_theme');
  document.documentElement.removeAttribute('data-theme');
});

describe('LocaleSwitcher', () => {
  it('names the current language and lists both, with the current one checked', async () => {
    const user = userEvent.setup();
    renderUi(<LocaleSwitcher />, { locale: 'en' });
    const trigger = screen.getByRole('button', { name: 'Language: English' });
    await user.click(trigger);
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'العربية' })).not.toBeChecked();
    expect(screen.getByText('العربية')).toHaveAttribute('lang', 'ar');
  });

  it('choosing a language writes the aivore_locale cookie and refreshes the route', async () => {
    const user = userEvent.setup();
    router.refresh.mockClear();
    renderUi(<LocaleSwitcher />, { locale: 'en' });
    await user.click(screen.getByRole('button', { name: /Language/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'العربية' }));
    expect(document.cookie).toContain('aivore_locale=ar');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('choosing the current language does nothing', async () => {
    const user = userEvent.setup();
    router.refresh.mockClear();
    renderUi(<LocaleSwitcher />, { locale: 'ar' });
    await user.click(screen.getByRole('button', { name: /اللغة/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'العربية' }));
    expect(document.cookie).not.toContain('aivore_locale');
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('ThemeToggle', () => {
  it('offers Light, Dark and System with the page theme checked', async () => {
    const user = userEvent.setup();
    renderUi(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).not.toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'System' })).not.toBeChecked();
  });

  it('applies the theme at once, writes the aivore_theme cookie and refreshes', async () => {
    const user = userEvent.setup();
    router.refresh.mockClear();
    renderUi(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.cookie).toContain('aivore_theme=light');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toBeChecked();
  });

  it('is localized', async () => {
    const user = userEvent.setup();
    renderUi(<ThemeToggle />, { locale: 'ar' });
    await user.click(screen.getByRole('button', { name: 'المظهر' }));
    expect(screen.getByRole('menuitemradio', { name: 'فاتح' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'داكن' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'تلقائي' })).toBeInTheDocument();
  });

  it('shows the icon of the current theme by CSS on <html data-theme>, so the server markup is right', () => {
    const { container } = renderUi(<ThemeToggle />);
    const classes = Array.from(container.querySelectorAll('svg')).map((svg) =>
      svg.getAttribute('class'),
    );
    expect(classes.join(' ')).toContain('[[data-theme=light]_&]:block');
    expect(classes.join(' ')).toContain('[[data-theme=dark]_&]:block');
    expect(classes.join(' ')).toContain('[[data-theme=system]_&]:block');
  });
});

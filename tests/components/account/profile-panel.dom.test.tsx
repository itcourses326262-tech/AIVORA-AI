import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePanel } from '@/components/account/profile-panel';
import { NAME_MAX_LENGTH } from '@/components/auth/schemas';
import { I18nProvider } from '@/lib/i18n/client';
import { dirOf, type Locale } from '@/lib/i18n/locales';
import { UserProvider } from '@/lib/user-context';
import { axeViolations } from '../axe';
import {
  apiError,
  installFakeApi,
  json,
  LAYLA,
  mountAccount,
  resetAccountTest,
  router,
} from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/account' }));

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});
afterEach(resetAccountTest);

const name = () => screen.getByRole('textbox', { name: /^Name/ });
const save = () => screen.getByRole('button', { name: /^Save changes|^Saving/ });
const language = () => screen.getByRole('radiogroup', { name: 'Language' });

const saved = (patch: object) => json({ data: { ...LAYLA, ...patch } });

describe('ProfilePanel', () => {
  it('shows who you are, with the email read only and the current language chosen', () => {
    installFakeApi();
    mountAccount(<ProfilePanel />);
    expect(name()).toHaveValue('Layla');
    expect(name()).toHaveAttribute('autocomplete', 'name');
    const email = screen.getByRole('textbox', { name: 'Email' });
    expect(email).toHaveValue('layla@example.com');
    expect(email).toHaveAttribute('readonly');
    expect(email).toHaveAttribute('dir', 'ltr');
    expect(within(language()).getByRole('radio', { name: 'English' })).toBeChecked();
    expect(document.querySelector('form')).toHaveAttribute('novalidate');
  });

  it('keeps Save off until something changed, and trailing spaces are not a change', async () => {
    installFakeApi();
    const user = userEvent.setup();
    mountAccount(<ProfilePanel />);
    expect(save()).toBeDisabled();
    await user.type(name(), '   ');
    expect(save()).toBeDisabled();
    await user.type(name(), 'K');
    expect(save()).toBeEnabled();
  });

  it('sends only the name when only the name changed, then refreshes the page and the user', async () => {
    const api = installFakeApi({ 'PATCH /account': () => saved({ name: 'Layla K' }) });
    const user = userEvent.setup();
    mountAccount(<ProfilePanel />);
    await user.clear(name());
    await user.type(name(), '  Layla K  ');
    await user.click(save());
    expect(await screen.findByText('Profile saved')).toBeInTheDocument();
    expect(api.to('PATCH /account')).toHaveLength(1);
    expect(api.to('PATCH /account')[0]?.body).toEqual({ name: 'Layla K' });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(api.to('GET /auth/me').length).toBeGreaterThan(0);
    expect(name()).toHaveValue('Layla K');
  });

  it('sends only the language when only the language changed, and writes the locale cookie', async () => {
    const api = installFakeApi({ 'PATCH /account': () => saved({ locale: 'ar' }) });
    const user = userEvent.setup();
    mountAccount(<ProfilePanel />);
    await user.click(within(language()).getByRole('radio', { name: 'العربية' }));
    await user.click(save());
    await screen.findByText('Profile saved');
    expect(api.to('PATCH /account')[0]?.body).toEqual({ locale: 'ar' });
    expect(document.cookie).toContain('aivore_locale=ar');
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('sends both when both changed', async () => {
    const api = installFakeApi({ 'PATCH /account': () => saved({}) });
    const user = userEvent.setup();
    mountAccount(<ProfilePanel />);
    await user.clear(name());
    await user.type(name(), 'Noor');
    await user.click(within(language()).getByRole('radio', { name: 'العربية' }));
    await user.click(save());
    await screen.findByText('Profile saved');
    expect(api.to('PATCH /account')[0]?.body).toEqual({ name: 'Noor', locale: 'ar' });
  });

  it('asks for a name before sending anything', async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    mountAccount(<ProfilePanel />);
    await user.clear(name());
    await user.click(save());
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument();
    expect(name()).toHaveAttribute('aria-invalid', 'true');
    expect(api.to('PATCH /account')).toHaveLength(0);
    await user.type(name(), 'N');
    expect(screen.queryByText('Enter your name.')).not.toBeInTheDocument();
  });

  it('counts characters, not code units, against the limit', async () => {
    const api = installFakeApi({ 'PATCH /account': () => saved({}) });
    const user = userEvent.setup();
    mountAccount(<ProfilePanel />);
    await user.clear(name());
    await user.click(name());
    await user.paste('😀'.repeat(NAME_MAX_LENGTH + 1));
    await user.click(save());
    expect(
      await screen.findByText(`Use ${NAME_MAX_LENGTH} characters or fewer.`),
    ).toBeInTheDocument();
    expect(api.to('PATCH /account')).toHaveLength(0);
    await user.clear(name());
    await user.paste('😀'.repeat(NAME_MAX_LENGTH));
    await user.click(save());
    await screen.findByText('Profile saved');
    expect(api.to('PATCH /account')).toHaveLength(1);
  });

  it('pins a refused name to its field', async () => {
    installFakeApi({
      'PATCH /account': () =>
        apiError(422, 'validation_failed', { issues: [{ path: 'name', message: 'bad' }] }),
    });
    const user = userEvent.setup();
    mountAccount(<ProfilePanel />);
    await user.type(name(), '\u0007');
    await user.click(save());
    expect(
      await screen.findByText('Use only printable characters in your name.'),
    ).toBeInTheDocument();
    expect(name()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Profile saved')).not.toBeInTheDocument();
  });

  it('says how long to wait after a rate limit, in words of the app and not the server', async () => {
    installFakeApi({
      'PATCH /account': () => apiError(429, 'rate_limited', { retryAfterSec: 30 }),
    });
    const user = userEvent.setup();
    mountAccount(<ProfilePanel />);
    await user.type(name(), 'x');
    await user.click(save());
    expect(
      await screen.findByText('Too many attempts. Try again in 30 seconds.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('English message for developers')).not.toBeInTheDocument();
    // The form stays usable.
    expect(save()).toBeEnabled();
  });

  it('asks the server again when the session is gone, which sends the user to log in', async () => {
    installFakeApi({ 'PATCH /account': () => apiError(401, 'unauthorized') });
    const user = userEvent.setup();
    mountAccount(<ProfilePanel />);
    await user.type(name(), 'x');
    await user.click(save());
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(await screen.findByText('Please log in to continue.')).toBeInTheDocument();
  });

  it('does not send twice while a save is in flight', async () => {
    let finish: (response: Response) => void = () => undefined;
    const api = installFakeApi({
      'PATCH /account': () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    const user = userEvent.setup();
    mountAccount(<ProfilePanel />);
    await user.type(name(), 'x');
    await user.click(save());
    await screen.findByRole('button', { name: /Saving/ });
    await user.keyboard('{Enter}');
    expect(api.to('PATCH /account')).toHaveLength(1);
    finish(saved({ name: 'Laylax' }));
    await screen.findByText('Profile saved');
  });

  describe('when the interface changes language while the form is open', () => {
    // The language menu of the header only writes the cookie and renders the page again: the
    // provider gets a new locale and this form, still mounted, must follow it.
    function mountSwitchable() {
      const tree = (locale: Locale) => (
        <I18nProvider locale={locale}>
          <UserProvider initialUser={LAYLA}>
            <ProfilePanel />
          </UserProvider>
        </I18nProvider>
      );
      const view = render(tree('en'));
      return {
        switchTo(locale: Locale) {
          document.documentElement.lang = locale;
          document.documentElement.dir = dirOf(locale);
          view.rerender(tree(locale));
        },
      };
    }
    const radio = (label: string) =>
      within(screen.getByRole('radiogroup')).getByRole('radio', { name: label });

    it('shows the language of the interface now, and lets the reader save it', async () => {
      const api = installFakeApi({ 'PATCH /account': () => saved({ locale: 'ar' }) });
      const user = userEvent.setup();
      const view = mountSwitchable();
      expect(radio('English')).toBeChecked();
      view.switchTo('ar');
      expect(radio('العربية')).toBeChecked();
      expect(radio('English')).not.toBeChecked();
      // The account still remembers English, so there is something to save.
      const button = screen.getByRole('button', { name: /^حفظ التغييرات/ });
      expect(button).toBeEnabled();
      await user.click(button);
      await waitFor(() => expect(api.to('PATCH /account')).toHaveLength(1));
      expect(api.to('PATCH /account')[0]?.body).toEqual({ locale: 'ar' });
    });

    it('drops a choice made in the form when the language changes, and keeps it otherwise', async () => {
      installFakeApi();
      const user = userEvent.setup();
      const view = mountSwitchable();
      await user.click(radio('العربية'));
      expect(radio('العربية')).toBeChecked();
      expect(save()).toBeEnabled();
      // The menu then picks Arabic and back to English: the earlier pick must not come back.
      view.switchTo('ar');
      view.switchTo('en');
      expect(radio('English')).toBeChecked();
      expect(radio('العربية')).not.toBeChecked();
      expect(save()).toBeDisabled();
    });

    it('keeps the name being typed', async () => {
      installFakeApi();
      const user = userEvent.setup();
      const view = mountSwitchable();
      await user.type(name(), ' K');
      view.switchTo('ar');
      expect(screen.getByRole('textbox', { name: /^الاسم/ })).toHaveValue('Layla K');
    });
  });

  it('is in Arabic, with the email and the name field behaving in a right-to-left page', async () => {
    installFakeApi();
    const { container } = mountAccount(<ProfilePanel />, {
      locale: 'ar',
      user: { ...LAYLA, locale: 'ar' },
    });
    expect(screen.getByRole('heading', { level: 2, name: 'الملف الشخصي' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'البريد الإلكتروني' })).toHaveAttribute(
      'dir',
      'ltr',
    );
    expect(
      within(screen.getByRole('radiogroup', { name: 'اللغة' })).getByRole('radio', {
        name: 'العربية',
      }),
    ).toBeChecked();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('has no accessibility violations in English either', async () => {
    installFakeApi();
    const { container } = mountAccount(<ProfilePanel />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

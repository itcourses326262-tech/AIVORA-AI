import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDataRights } from '@/components/auth/account-data-rights';
import { Toaster, toast } from '@/components/ui/toast';
import { UserProvider, type CurrentUser } from '@/lib/user-context';
import { axeViolations } from '../axe';
import { renderUi } from '../render';
import { apiError, bodyOf, router, stubFetch } from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/account' }));

const LAYLA: CurrentUser = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla',
  role: 'user',
  locale: 'en',
  creditBalance: 120,
};

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});
afterEach(() => {
  vi.useFakeTimers();
  act(() => {
    toast.dismissAll();
    vi.advanceTimersByTime(1000);
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

const mount = (locale: 'ar' | 'en' = 'en') =>
  renderUi(
    <UserProvider initialUser={LAYLA}>
      <AccountDataRights />
      <Toaster />
    </UserProvider>,
    { locale },
  );

describe('export', () => {
  function stubDownload() {
    const created: Blob[] = [];
    const clicked: Array<{ href: string; download: string }> = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:aivore-export';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    return { created, clicked, click };
  }

  it('downloads the file under the name the server chose', async () => {
    const { created, clicked } = stubDownload();
    const fetchMock = stubFetch(
      () =>
        new Response('{"format":"aivore-account-export/1"}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-disposition': 'attachment; filename="aivore-export-2026-10-08.json"',
          },
        }),
    );
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Download my data' }));

    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/account/export');
    expect(clicked[0]).toEqual({
      href: 'blob:aivore-export',
      download: 'aivore-export-2026-10-08.json',
    });
    expect(await created[0]?.text()).toBe('{"format":"aivore-account-export/1"}');
    // The link used to trigger it does not stay in the page.
    expect(document.querySelector('a[download]')).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Download my data' })).toBeEnabled(),
    );
  });

  it('shows the limit in words when the daily downloads are used up', async () => {
    stubDownload();
    stubFetch(() => apiError(429, 'rate_limited', { retryAfterSec: 80000 }));
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Download my data' }));
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('survives a dropped connection', async () => {
    stubDownload();
    stubFetch(() => Promise.reject(new TypeError('offline')));
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Download my data' }));
    expect(await screen.findByText('We could not prepare the download.')).toBeInTheDocument();
  });

  it('is busy once, however often it is clicked', async () => {
    stubDownload();
    let release: (response: Response) => void = () => {};
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Download my data' }));
    await user.click(screen.getByRole('button', { name: 'Preparing…' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(new Response('{}', { status: 200 }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Download my data' })).toBeEnabled(),
    );
  });
});

describe('delete', () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Delete my account…' }));
    return screen.findByRole('alertdialog', { name: 'Delete your account?' });
  }
  const passwordIn = (dialog: HTMLElement) =>
    within(dialog).getByLabelText(/^Enter your password to confirm/);
  const confirmIn = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: /^Delete forever|^Deleting/ });

  it('asks first, and says what is lost, with the balance in the active language', async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openDialog(user);
    expect(dialog).toHaveTextContent('your remaining balance (120 credits) will be lost');
    expect(dialog).toHaveTextContent('any subscription will be canceled');
    expect(passwordIn(dialog)).toHaveAttribute('type', 'password');
    expect(passwordIn(dialog)).toHaveAttribute('autocomplete', 'current-password');
    expect(confirmIn(dialog)).toBeDisabled();
  });

  it('can be backed out of without a request', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    mount();
    const dialog = await openDialog(user);
    await user.type(passwordIn(dialog), 'secret');
    await user.click(within(dialog).getByRole('button', { name: 'Keep my account' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
    // Opening it again starts clean: no password left over from before.
    const again = await openDialog(user);
    expect(passwordIn(again)).toHaveValue('');
  });

  it('sends the password with DELETE and leaves for the home page', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    mount();
    const dialog = await openDialog(user);
    await user.type(passwordIn(dialog), 'my password 123');
    await user.click(confirmIn(dialog));

    await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith('/'));
    expect(router.refresh).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/account');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(bodyOf(fetchMock)).toEqual({ password: 'my password 123' });
  });

  it('points at the password field when it is wrong, and keeps the dialog', async () => {
    stubFetch(() =>
      apiError(422, 'validation_failed', { issues: [{ path: 'password', message: 'x' }] }),
    );
    const user = userEvent.setup();
    mount();
    const dialog = await openDialog(user);
    await user.type(passwordIn(dialog), 'wrong');
    await user.click(confirmIn(dialog));
    expect(await within(dialog).findByText('That password is not correct.')).toBeInTheDocument();
    expect(passwordIn(dialog)).toHaveAttribute('aria-invalid', 'true');
    expect(router.replace).not.toHaveBeenCalled();
    // Typing again answers the complaint.
    await user.type(passwordIn(dialog), 'x');
    expect(within(dialog).queryByText('That password is not correct.')).not.toBeInTheDocument();
  });

  it('explains that nothing was deleted when the subscription could not be canceled', async () => {
    stubFetch(() => apiError(502, 'provider_error'));
    const user = userEvent.setup();
    mount();
    const dialog = await openDialog(user);
    await user.type(passwordIn(dialog), 'my password 123');
    await user.click(confirmIn(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'We could not cancel your subscription right now, so nothing was deleted.',
    );
    expect(confirmIn(dialog)).toBeEnabled();
  });

  it('shows other failures in words', async () => {
    stubFetch(() => apiError(409, 'conflict'));
    const user = userEvent.setup();
    mount();
    const dialog = await openDialog(user);
    await user.type(passwordIn(dialog), 'my password 123');
    await user.click(confirmIn(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /conflicts with the current state/,
    );
  });

  it('cannot be dismissed, or sent twice, while the request is out', async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    mount();
    const dialog = await openDialog(user);
    await user.type(passwordIn(dialog), 'my password 123');
    await user.click(confirmIn(dialog));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Keep my account' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(new Response(null, { status: 204 }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it('is right to left and fully in Arabic', async () => {
    const user = userEvent.setup();
    mount('ar');
    await user.click(screen.getByRole('button', { name: 'حذف حسابي…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'هل تريد حذف حسابك؟' });
    expect(dialog).toHaveTextContent('رصيدك المتبقي (١٢٠ رصيدًا)');
    expect(within(dialog).getByRole('button', { name: 'حذف نهائيًا' })).toBeDisabled();
  });
});

describe('accessibility', () => {
  it.each(['en', 'ar'] as const)(
    'has no violations in %s, closed or with the dialog open',
    async (locale) => {
      const user = userEvent.setup();
      const { container } = mount(locale);
      expect(await axeViolations(container)).toEqual([]);
      await user.click(
        screen.getByRole('button', { name: locale === 'en' ? 'Delete my account…' : 'حذف حسابي…' }),
      );
      const dialog = await screen.findByRole('alertdialog');
      expect(await axeViolations(dialog)).toEqual([]);
    },
  );
});

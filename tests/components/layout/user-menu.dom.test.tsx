import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserMenu } from '@/components/layout/user-menu';
import { toast } from '@/components/ui/toast';
import { UserProvider, type CurrentUser } from '@/lib/user-context';
import { renderUi } from '../render';

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/studio',
}));

const LAYLA: CurrentUser = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla Hassan',
  role: 'user',
  locale: 'en',
  creditBalance: 50,
};

function mount(
  options: {
    navigation?: boolean;
    preferences?: boolean;
    guest?: boolean;
    locale?: 'ar' | 'en';
  } = {},
) {
  return renderUi(
    <UserProvider initialUser={options.guest ? null : LAYLA}>
      <UserMenu navigation={options.navigation} preferences={options.preferences} />
    </UserProvider>,
    { locale: options.locale },
  );
}

const open = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Account menu' }));

beforeEach(() => {
  router.refresh.mockClear();
  router.replace.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UserMenu', () => {
  it('renders nothing for a visitor', () => {
    const { container } = mount({ guest: true });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows who is signed in', async () => {
    const user = userEvent.setup();
    mount();
    await open(user);
    expect(screen.getByRole('menu', { name: 'Account menu' })).toHaveTextContent('Layla Hassan');
    expect(screen.getByRole('menu')).toHaveTextContent('layla@example.com');
  });

  it('includes navigation, language, theme and log out by default', async () => {
    const user = userEvent.setup();
    mount();
    await open(user);
    expect(screen.getByRole('menuitem', { name: 'Studio' })).toHaveAttribute('href', '/studio');
    expect(screen.getByRole('menuitem', { name: 'Gallery' })).toHaveAttribute('href', '/gallery');
    expect(screen.getByRole('menuitem', { name: 'Account' })).toHaveAttribute('href', '/account');
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
  });

  it('can leave out the navigation (the app shell has its own) or the preferences (the header has them)', async () => {
    const user = userEvent.setup();
    mount({ navigation: false, preferences: false });
    await open(user);
    expect(screen.queryByRole('menuitem', { name: 'Studio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
  });

  it('logs out through POST /api/v1/auth/logout, then goes home and refreshes', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    mount();
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/logout');
    expect(init.method).toBe('POST');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('reports a failed logout in the active language and stays where it is', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    const error = vi.spyOn(toast, 'error').mockReturnValue('t');
    mount({ locale: 'ar' });
    await user.click(screen.getByRole('button', { name: 'قائمة الحساب' }));
    await user.click(screen.getByRole('menuitem', { name: 'تسجيل الخروج' }));
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error.mock.calls[0]?.[0]).toContain('تعذّر الاتصال بالخادم');
    expect(router.replace).not.toHaveBeenCalled();
  });
});

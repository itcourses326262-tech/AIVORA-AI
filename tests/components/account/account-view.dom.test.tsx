import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountView } from '@/components/account/account-view';
import { ACCOUNT_TABS, parseAccountTab, type AccountTab } from '@/components/account/tabs';
import { UserProvider } from '@/lib/user-context';
import { axeViolations } from '../axe';
import { renderUi } from '../render';
import { installFakeApi, json, LAYLA, mountAccount, resetAccountTest, router } from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/account' }));

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});
afterEach(resetAccountTest);

const LIMITS = { maxActive: 5, nameMax: 40 };
const ORIGIN = 'https://aivore.example';

function fakeApi() {
  return installFakeApi({
    'GET /account/ledger': () => json({ data: [], nextCursor: null }),
    'GET /keys': () => json({ data: [], nextCursor: null }),
  });
}

const mount = (initialTab: AccountTab = 'profile', locale: 'en' | 'ar' = 'en') =>
  mountAccount(<AccountView initialTab={initialTab} limits={LIMITS} origin={ORIGIN} />, {
    locale,
    user: { ...LAYLA, locale },
  });

const tab = (name: string) => screen.getByRole('tab', { name });
const here = () => window.location.pathname + window.location.search;

/** The names of the tabs and which one is selected. */
const selected = () =>
  screen
    .getAllByRole('tab')
    .filter((item) => item.getAttribute('aria-selected') === 'true')
    .map((item) => item.textContent);

describe('the account page', () => {
  it('says who you are and leads to billing', () => {
    fakeApi();
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument();
    expect(screen.getByText('Layla')).toBeInTheDocument();
    expect(screen.getByText('layla@example.com')).toHaveAttribute('dir', 'ltr');
    const billing = screen.getAllByRole('link', { name: /Billing & plans/ })[0];
    expect(billing).toHaveAttribute('href', '/account/billing');
  });

  it('has the five sections as tabs, in order, with the profile open by default', () => {
    fakeApi();
    mount();
    expect(screen.getByRole('tablist', { name: 'Account sections' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((item) => item.textContent)).toEqual([
      'Profile',
      'Security',
      'Credits',
      'API keys',
      'Your data',
    ]);
    expect(selected()).toEqual(['Profile']);
    expect(screen.getByRole('tabpanel', { name: 'Profile' })).toBeInTheDocument();
  });

  it.each([
    ['profile', 'Profile', /Save changes/],
    ['security', 'Security', /Update password/],
    ['credits', 'Credits', /Credit history/],
    ['keys', 'API keys', /Create key/],
    ['data', 'Your data', /Download|Delete/],
  ] as const)('opens the %s section from a deep link', async (value, name, content) => {
    fakeApi();
    mount(value);
    expect(selected()).toEqual([name]);
    const panel = screen.getByRole('tabpanel', { name });
    expect(await within(panel).findAllByText(content)).not.toHaveLength(0);
  });

  it('only builds a section when it is opened, and keeps it afterwards', async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    mount();
    expect(api.to('GET /account/ledger')).toHaveLength(0);
    expect(api.to('GET /keys')).toHaveLength(0);

    await user.click(tab('Credits'));
    await screen.findByText('No activity yet');
    expect(api.to('GET /account/ledger')).toHaveLength(1);
    expect(api.to('GET /keys')).toHaveLength(0);

    await user.click(tab('API keys'));
    await screen.findByText('No API keys yet');
    expect(api.to('GET /keys')).toHaveLength(1);

    // Back and forth: nothing is fetched again.
    await user.click(tab('Credits'));
    await user.click(tab('API keys'));
    await user.click(tab('Credits'));
    expect(api.to('GET /account/ledger')).toHaveLength(1);
    expect(api.to('GET /keys')).toHaveLength(1);
  });

  it('keeps what was typed in a form while another tab is looked at', async () => {
    fakeApi();
    const user = userEvent.setup();
    mount();
    const name = screen.getByRole('textbox', { name: /^Name/ });
    await user.type(name, ' Khan');
    await user.click(tab('Security'));
    await user.type(await screen.findByLabelText(/^Current password/), 'secret value');
    await user.click(tab('Profile'));
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Layla Khan');
    await user.click(tab('Security'));
    expect(screen.getByLabelText(/^Current password/)).toHaveValue('secret value');
  });

  it('shows only the selected section to assistive technology', async () => {
    fakeApi();
    const user = userEvent.setup();
    mount();
    await user.click(tab('Security'));
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel', { name: 'Security' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: /^Name/ })).toBeNull();
  });
});

describe('the address', () => {
  it('follows the tab without adding history entries', async () => {
    fakeApi();
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/account');
    const length = window.history.length;
    mount();
    await user.click(tab('Security'));
    expect(here()).toBe('/account?tab=security');
    await user.click(tab('API keys'));
    expect(here()).toBe('/account?tab=keys');
    await user.click(tab('Profile'));
    expect(here()).toBe('/account');
    expect(window.history.length).toBe(length);
  });

  it.each(ACCOUNT_TABS)('gives the %s tab an address that opens that very tab', async (value) => {
    fakeApi();
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/account');
    const first = mount();
    const label = screen.getAllByRole('tab')[ACCOUNT_TABS.indexOf(value)]?.textContent ?? '';
    await user.click(tab(label));
    const address = new URL(here(), 'http://localhost');
    first.unmount();
    mount(parseAccountTab(address.searchParams.get('tab') ?? undefined));
    expect(selected()).toEqual([label]);
  });

  it('follows a link to another tab of the same page (a new initial tab)', async () => {
    fakeApi();
    function Page({ initialTab }: { initialTab: AccountTab }) {
      return (
        <UserProvider initialUser={LAYLA}>
          <AccountView initialTab={initialTab} limits={LIMITS} origin={ORIGIN} />
        </UserProvider>
      );
    }
    const { rerender } = renderUi(<Page initialTab="profile" />);
    expect(selected()).toEqual(['Profile']);
    rerender(<Page initialTab="credits" />);
    expect(selected()).toEqual(['Credits']);
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    rerender(<Page initialTab="profile" />);
    expect(selected()).toEqual(['Profile']);
  });
});

describe('the keyboard', () => {
  it('moves between tabs with the arrow keys in the direction of reading', async () => {
    fakeApi();
    const user = userEvent.setup();
    mount();
    tab('Profile').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Security')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('Your data')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab('Profile')).toHaveFocus();
  });

  it('turns the arrows around in Arabic', async () => {
    fakeApi();
    const user = userEvent.setup();
    mount('profile', 'ar');
    const first = screen.getAllByRole('tab')[0] as HTMLElement;
    first.focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getAllByRole('tab')[1]).toHaveFocus();
  });
});

describe('in Arabic', () => {
  it('speaks Arabic everywhere on the page, including the sections', async () => {
    fakeApi();
    const user = userEvent.setup();
    mount('profile', 'ar');
    expect(screen.getByRole('heading', { level: 1, name: 'الحساب' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((item) => item.textContent)).toEqual([
      'الملف الشخصي',
      'الأمان',
      'الرصيد',
      'مفاتيح API',
      'بياناتك',
    ]);
    await user.click(screen.getByRole('tab', { name: 'الرصيد' }));
    expect(await screen.findByText('لا توجد عمليات بعد')).toBeInTheDocument();
    expect(selected()).toEqual(['الرصيد']);
  });
});

describe('accessibility', () => {
  it.each(ACCOUNT_TABS)('has no violations on the %s section, in English', async (value) => {
    fakeApi();
    const { container } = mount(value);
    await act(async () => undefined);
    await waitFor(() => expect(screen.getAllByRole('tabpanel').length).toBe(1));
    await screen.findAllByRole('heading');
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each(ACCOUNT_TABS)('has no violations on the %s section, in Arabic', async (value) => {
    fakeApi();
    const { container } = mount(value, 'ar');
    await act(async () => undefined);
    await screen.findAllByRole('heading');
    expect(await axeViolations(container)).toEqual([]);
  });
});

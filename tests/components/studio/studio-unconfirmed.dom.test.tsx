import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../axe';
import { USER, apiError, json } from '../generations/support';
import {
  generateButton,
  installDomStubs,
  mountStudio,
  promptBox,
  ready,
  resetEnvironment,
  toastTexts,
  type MountOptions,
} from './support';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/studio' }));

beforeEach(() => {
  installDomStubs();
  nav.refresh.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  resetEnvironment();
});

/** A new account on a server that wants its address confirmed: no credits until it is. */
const UNCONFIRMED = {
  creditBalance: 0,
  emailVerified: false,
  emailVerificationRequired: true,
  pendingBonusCredits: 50,
} as const;

const TITLE = 'Confirm your email to start creating';

interface Server {
  /** What `GET /auth/me` answers now: change it to "confirm in another tab". */
  me: Record<string, unknown>;
  resend: Array<{ status: number; body: unknown }>;
}

function mount(options: MountOptions & { server?: Partial<Server> } = {}) {
  const server: Server = {
    me: { ...USER, ...UNCONFIRMED, createdAt: 0 },
    resend: [],
    ...options.server,
  };
  const mounted = mountStudio({
    balance: 0,
    user: UNCONFIRMED,
    ...options,
    prepare: (api) => {
      options.prepare?.(api);
      api.intercept((call) => {
        if (call.method === 'GET' && call.path === '/auth/me') return json({ data: server.me });
        if (call.method === 'POST' && call.path === '/auth/verify-email/request') {
          const next = server.resend.shift();
          if (next?.status !== undefined && next.status >= 400) {
            return apiError(next.status, 'rate_limited', next.body);
          }
          return json({
            data: next?.body ?? { sent: true, verified: false, resendAfterSec: 60 },
          });
        }
        return undefined;
      });
    },
  });
  return { ...mounted, server };
}

/** The person comes back to the tab after a while (`Date` only; the page's own timers are real). */
async function comeBackAfter(ms: number, how: 'focus' | 'visibility' = 'focus') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + ms);
  await act(async () => {
    if (how === 'focus') window.dispatchEvent(new Event('focus'));
    else document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('Studio: an account that has not confirmed its email address', () => {
  it('asks for the confirmation, not for credits: no "get credits", Generate off and explained by the notice', async () => {
    mount();
    await ready();

    expect(document.getElementById('studio-confirm-email')).toHaveTextContent(TITLE);
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(/We sent a link to .*layla@example\.com.*Open it, then come back/),
    ).toBeInTheDocument();
    // Confirming pays no credits, so the notice promises none even when the server reports 50 pending.
    expect(screen.queryByText(/free credits|sign-up bonus|add 50 credits/)).not.toBeInTheDocument();
    // The old advice would send a person to buy what they cannot use.
    expect(screen.queryByText(/enough credits/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Get credits' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend link' })).toBeEnabled();

    const button = generateButton();
    expect(button).toBeDisabled();
    const described = button.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described ?? '')).toHaveTextContent(TITLE);
  });

  it('says the same to an account that has no bonus pending, and blocks it even when it has credits', async () => {
    mount({
      balance: 20,
      user: { ...UNCONFIRMED, creditBalance: 20, pendingBonusCredits: 0 },
      server: {
        me: { ...USER, ...UNCONFIRMED, creditBalance: 20, pendingBonusCredits: 0, createdAt: 0 },
      },
    });
    await ready();
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.queryByText(/free credits|sign-up bonus/)).not.toBeInTheDocument();
    // 20 credits would pay for an image, but the server refuses the generation until the address is confirmed.
    expect(generateButton()).toBeDisabled();
  });

  it('sends nothing when the shortcut is used anyway, and says why to a screen reader', async () => {
    const { api } = mount();
    await ready();
    const user = userEvent.setup();
    await user.type(promptBox(), 'a lighthouse at dawn');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(api.callsTo('POST', '/generations')).toEqual([]);
    expect(document.querySelector('p.sr-only[aria-live="polite"]')?.textContent).toContain(TITLE);
  });

  it('offers a new link: one request, the countdown of the server, a toast', async () => {
    const { api } = mount();
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Resend link' }));

    expect(api.callsTo('POST', '/auth/verify-email/request')).toHaveLength(1);
    const waiting = await screen.findByRole('button', { name: /^Resend in 60 seconds/ });
    expect(waiting).toBeDisabled();
    expect(toastTexts().join(' ')).toContain('Confirmation email sent');
  });

  it("counts down the server's own wait when a link was requested a moment ago", async () => {
    const { api } = mount({ server: { resend: [{ status: 429, body: { retryAfterSec: 42 } }] } });
    await ready();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Resend link' }));
    expect(await screen.findByRole('button', { name: /^Resend in 42 seconds/ })).toBeDisabled();
    expect(api.callsTo('POST', '/auth/verify-email/request')).toHaveLength(1);
  });

  it('notices on its own that the address was confirmed in another tab: the notice goes, the bonus is there, Generate works', async () => {
    const { server } = mount();
    await ready();
    expect(generateButton()).toBeDisabled();

    // The link was opened elsewhere: the bonus is paid and the account is confirmed.
    server.me = {
      ...USER,
      creditBalance: 50,
      emailVerified: true,
      emailVerificationRequired: true,
      pendingBonusCredits: 0,
      createdAt: 0,
    };
    await comeBackAfter(10_000);

    await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument());
    expect(screen.getByText('Balance: 50')).toBeInTheDocument();
    expect(generateButton()).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Resend link' })).not.toBeInTheDocument();
  });

  it('also notices when the tab becomes visible again (the usual way back from a mail client on a phone)', async () => {
    const { server } = mount();
    await ready();
    server.me = {
      ...USER,
      creditBalance: 50,
      emailVerified: true,
      emailVerificationRequired: true,
      pendingBonusCredits: 0,
      createdAt: 0,
    };
    await comeBackAfter(10_000, 'visibility');
    await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument());
    expect(generateButton()).toBeEnabled();
  });

  it('is told "already confirmed" by the resend itself and refreshes the state, without waiting for a focus', async () => {
    const { server } = mount({
      server: {
        resend: [{ status: 200, body: { sent: false, verified: true, resendAfterSec: 0 } }],
      },
    });
    await ready();
    server.me = {
      ...USER,
      creditBalance: 50,
      emailVerified: true,
      emailVerificationRequired: true,
      pendingBonusCredits: 0,
      createdAt: 0,
    };
    await userEvent.setup().click(screen.getByRole('button', { name: 'Resend link' }));
    await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument());
    expect(generateButton()).toBeEnabled();
  });

  it('stays as it is while nothing changed, however often the tab comes back', async () => {
    const { api } = mount();
    await ready();
    await comeBackAfter(10_000);
    await waitFor(() => expect(api.callsTo('GET', '/auth/me').length).toBeGreaterThan(0));
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
  });

  it('says the same on a phone: in the composer, with Generate off', async () => {
    mount({ desktop: false });
    await screen.findByRole('button', { name: 'Settings' });
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.queryByText(/enough credits/)).not.toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resend link' })).toBeInTheDocument();
    // The strip above the tab bar is one line: the longer explanation is for screen readers only.
    expect(screen.getByText(/We sent a link to/).className).toContain('sr-only');
  });

  it('gives the roomy panel on a wide screen the explanation in full, visibly', async () => {
    mount();
    await ready();
    expect(screen.getByText(/We sent a link to/).className).not.toContain('sr-only');
  });

  it('speaks Arabic, with the address kept left to right', async () => {
    mount({ locale: 'ar' });
    await ready();
    expect(screen.getByText('أكّد بريدك الإلكتروني لتبدأ الإنشاء')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/مجاني|هدية|مكافأة/);
    expect(screen.getByRole('button', { name: 'إعادة إرسال الرابط' })).toBeInTheDocument();
    const body = screen.getByText(/أرسلنا رابطًا إلى/);
    expect(body.textContent).toContain(
      `${String.fromCodePoint(0x2066)}layla@example.com${String.fromCodePoint(0x2069)}`,
    );
    expect(screen.queryByText(/ليس لديك رصيد كافٍ|لا تملك رصيدًا كافيًا/)).not.toBeInTheDocument();
  });

  it('passes the accessibility checks in both languages', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const { view } = mount({ locale });
      await ready();
      expect(await axeViolations(view.container)).toEqual([]);
      view.unmount();
      resetEnvironment();
    }
  });
});

describe('Studio: nobody else is affected', () => {
  it('still offers "Get credits" to a confirmed account that ran out', async () => {
    mount({
      balance: 0,
      user: {
        creditBalance: 0,
        emailVerified: true,
        emailVerificationRequired: true,
        pendingBonusCredits: 0,
      },
      server: {
        me: {
          ...USER,
          creditBalance: 0,
          emailVerified: true,
          emailVerificationRequired: true,
          pendingBonusCredits: 0,
          createdAt: 0,
        },
      },
    });
    await ready();
    expect(screen.getByRole('link', { name: 'Get credits' })).toHaveAttribute('href', '/pricing');
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
  });

  it('shows no notice on a server that does not ask for confirmation, whatever the account has done', async () => {
    mount({
      balance: 50,
      user: {
        creditBalance: 50,
        emailVerified: false,
        emailVerificationRequired: false,
        pendingBonusCredits: 0,
      },
      server: {
        me: {
          ...USER,
          creditBalance: 50,
          emailVerified: false,
          emailVerificationRequired: false,
          pendingBonusCredits: 0,
          createdAt: 0,
        },
      },
    });
    await ready();
    expect(screen.queryByText(/Confirm your email/)).not.toBeInTheDocument();
    expect(generateButton()).toBeEnabled();
  });

  it('keeps the old behaviour for a user object without the new fields (nothing to confirm)', async () => {
    mountStudio({ balance: 50, user: {} });
    await ready();
    fireEvent.focus(window);
    expect(screen.queryByText(/Confirm your email/)).not.toBeInTheDocument();
    expect(generateButton()).toBeEnabled();
  });
});

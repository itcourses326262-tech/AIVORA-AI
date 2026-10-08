import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditsPanel } from '@/components/account/credits-panel';
import { LEDGER_PAGE_SIZE } from '@/components/account/use-ledger';
import { REASON_KEYS } from '@/components/account/ledger';
import type { LedgerEntryDTO, LedgerReason } from '@/lib/api-types';
import { createTranslator } from '@/lib/i18n';
import { axeViolations } from '../axe';
import {
  apiError,
  installFakeApi,
  json,
  LAYLA,
  mountAccount,
  resetAccountTest,
  router,
  type Handler,
} from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/account' }));

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});
afterEach(resetAccountTest);

const NOW = Date.UTC(2026, 5, 1, 12, 0);

function entry(index: number, overrides: Partial<LedgerEntryDTO> = {}): LedgerEntryDTO {
  return {
    id: `led_${index}`,
    delta: -2,
    balanceAfter: 100 - index,
    reason: 'generation',
    createdAt: NOW - index * 60_000,
    ...overrides,
  };
}

const pageOf =
  (data: LedgerEntryDTO[], nextCursor: string | null): Handler =>
  () =>
    json({ data, nextCursor });

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('balance', () => {
  it('shows the live balance, a way to the billing page, and no warning while there is plenty', async () => {
    installFakeApi({ 'GET /account/ledger': pageOf([entry(1)], null) });
    mountAccount(<CreditsPanel />);
    expect(screen.getByText('Your balance')).toBeInTheDocument();
    expect(screen.getByText(/^120 credits$/)).toBeInTheDocument();
    expect(screen.queryByText('Running low')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Billing & plans/ });
    expect(link).toHaveAttribute('href', '/account/billing');
    await screen.findByRole('table');
  });

  it.each([5, 0])('warns when the balance is %i, nearly or entirely gone', async (balance) => {
    const user = { ...LAYLA, creditBalance: balance };
    installFakeApi({
      'GET /account/ledger': pageOf([entry(1)], null),
      'GET /auth/me': () => json({ data: user }),
    });
    mountAccount(<CreditsPanel />, { user });
    expect(await screen.findByText('Running low')).toBeInTheDocument();
  });

  it('reads the balance again, because the header copy may be a minute old', async () => {
    const api = installFakeApi({
      'GET /account/ledger': pageOf([entry(1)], null),
      'GET /auth/me': () => json({ data: { ...LAYLA, creditBalance: 77 } }),
    });
    mountAccount(<CreditsPanel />);
    expect(await screen.findByText(/^77 credits$/)).toBeInTheDocument();
    expect(api.to('GET /auth/me')).toHaveLength(1);
  });
});

describe('history', () => {
  it('lists the newest first, with what happened, the signed change and the balance after it', async () => {
    installFakeApi({
      'GET /account/ledger': pageOf(
        [
          entry(1, { delta: 10, reason: 'purchase', balanceAfter: 120 }),
          entry(2, { delta: -3, reason: 'generation', generationId: 'gen_abc', balanceAfter: 110 }),
          entry(3, { delta: 3, reason: 'refund', note: 'Failed generation', balanceAfter: 113 }),
        ],
        null,
      ),
    });
    mountAccount(<CreditsPanel />);
    await screen.findByRole('table');
    expect(screen.getByRole('table', { name: 'Credit history' })).toBeInTheDocument();
    const [purchase, generation, refund] = rows();
    expect(purchase).toHaveTextContent('Purchase');
    expect(purchase).toHaveTextContent('+10');
    expect(purchase).toHaveTextContent('Added');
    expect(generation).toHaveTextContent('Generation');
    expect(generation).toHaveTextContent(/[-−]3/);
    expect(generation).toHaveTextContent('Spent');
    expect(refund).toHaveTextContent('Refund');
    expect(refund).toHaveTextContent('Failed generation');
    expect(
      within(generation as HTMLElement).getByRole('link', { name: 'View generation' }),
    ).toHaveAttribute('href', '/gallery/gen_abc');
    expect(
      within(purchase as HTMLElement).queryByRole('link', { name: 'View generation' }),
    ).toBeNull();
    // Columns are real headers.
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Date',
      'Activity',
      'Change',
      'Balance',
    ]);
  });

  it('labels every reason there is, in both languages', async () => {
    const reasons = Object.keys(REASON_KEYS) as LedgerReason[];
    installFakeApi({
      'GET /account/ledger': pageOf(
        reasons.map((reason, index) => entry(index + 1, { reason })),
        null,
      ),
    });
    const view = mountAccount(<CreditsPanel />);
    await screen.findByRole('table');
    const english = createTranslator('en');
    for (const [index, reason] of reasons.entries()) {
      expect(rows()[index], reason).toHaveTextContent(english.t(REASON_KEYS[reason]));
    }
    view.unmount();
    mountAccount(<CreditsPanel />, { locale: 'ar' });
    await screen.findByRole('table');
    const arabic = createTranslator('ar');
    for (const [index, reason] of reasons.entries()) {
      expect(rows()[index], reason).toHaveTextContent(arabic.t(REASON_KEYS[reason]));
    }
  });

  it('asks for a page of the size it expects, and shows a skeleton until it arrives', async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = installFakeApi({
      'GET /account/ledger': () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    mountAccount(<CreditsPanel />);
    expect(screen.getByText('Loading', { selector: '.sr-only' })).toBeInTheDocument();
    expect(api.to('GET /account/ledger')[0]?.query.get('limit')).toBe(String(LEDGER_PAGE_SIZE));
    expect(api.to('GET /account/ledger')[0]?.query.has('cursor')).toBe(false);
    answer(json({ data: [entry(1)], nextCursor: null }));
    await screen.findByRole('table');
  });

  it('loads the next page with the cursor the server gave, appends it and ends with a full stop', async () => {
    const first = Array.from({ length: LEDGER_PAGE_SIZE }, (_, index) => entry(index + 1));
    const second = Array.from({ length: 5 }, (_, index) => entry(LEDGER_PAGE_SIZE + index + 1));
    const api = installFakeApi({
      'GET /account/ledger': ({ query }) =>
        query.get('cursor') === 'cur_1'
          ? json({ data: second, nextCursor: null })
          : json({ data: first, nextCursor: 'cur_1' }),
    });
    const user = userEvent.setup();
    mountAccount(<CreditsPanel />);
    await screen.findByRole('table');
    expect(rows()).toHaveLength(LEDGER_PAGE_SIZE);
    expect(screen.queryByText('That is everything.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows()).toHaveLength(LEDGER_PAGE_SIZE + 5));
    expect(api.to('GET /account/ledger').map((call) => call.query.get('cursor'))).toEqual([
      null,
      'cur_1',
    ]);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.getByText('That is everything.')).toBeInTheDocument();
    // Nothing doubled, order kept.
    expect(new Set(rows().map((row) => row.textContent)).size).toBe(LEDGER_PAGE_SIZE + 5);
  });

  it('does not fetch the same page twice while one is on its way', async () => {
    let finish: (response: Response) => void = () => undefined;
    const api = installFakeApi({
      'GET /account/ledger': ({ query }) =>
        query.get('cursor') === 'cur_1'
          ? new Promise<Response>((resolve) => (finish = resolve))
          : json({ data: [entry(1)], nextCursor: 'cur_1' }),
    });
    const user = userEvent.setup();
    mountAccount(<CreditsPanel />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    const busy = await screen.findByRole('button', { name: 'Loading…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await user.click(busy);
    expect(api.to('GET /account/ledger')).toHaveLength(2);
    finish(json({ data: [entry(2)], nextCursor: null }));
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it('keeps what is shown when a later page fails, and lets the reader try again', async () => {
    let failing = true;
    installFakeApi({
      'GET /account/ledger': ({ query }) => {
        if (query.get('cursor') !== 'cur_1') return json({ data: [entry(1)], nextCursor: 'cur_1' });
        return failing ? apiError(500, 'internal') : json({ data: [entry(2)], nextCursor: null });
      },
    });
    const user = userEvent.setup();
    mountAccount(<CreditsPanel />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('We could not load your credit history.')).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.queryByText('We could not load your credit history.')).not.toBeInTheDocument();
  });

  it('explains an empty history and points to the studio', async () => {
    installFakeApi({ 'GET /account/ledger': pageOf([], null) });
    mountAccount(<CreditsPanel />);
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the studio' })).toHaveAttribute(
      'href',
      '/studio',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a failed first page as an error with a retry that works', async () => {
    let failing = true;
    const api = installFakeApi({
      'GET /account/ledger': () =>
        failing
          ? apiError(503, 'service_unavailable')
          : json({ data: [entry(1)], nextCursor: null }),
    });
    const user = userEvent.setup();
    mountAccount(<CreditsPanel />);
    const alert = await screen.findByText('We could not load your credit history.');
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('table');
    expect(api.to('GET /account/ledger')).toHaveLength(2);
    expect(rows()).toHaveLength(1);
  });

  it('cancels its request when the reader leaves the tab', async () => {
    const api = installFakeApi({
      'GET /account/ledger': () => new Promise<Response>(() => undefined),
    });
    const view = mountAccount(<CreditsPanel />);
    const signal = api.to('GET /account/ledger')[0]?.signal;
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe('credits panel, as a whole', () => {
  it('has no accessibility violations, in English and in Arabic', async () => {
    installFakeApi({
      'GET /account/ledger': pageOf(
        [entry(1, { delta: 5, reason: 'signup_bonus' }), entry(2, { generationId: 'gen_1' })],
        'cur_1',
      ),
    });
    const english = mountAccount(<CreditsPanel />);
    await screen.findByRole('table');
    expect(await axeViolations(english.container)).toEqual([]);
    english.unmount();
    const arabic = mountAccount(<CreditsPanel />, {
      locale: 'ar',
      user: { ...LAYLA, locale: 'ar' },
    });
    await screen.findByRole('table');
    expect(screen.getByRole('heading', { level: 2, name: 'سجل الرصيد' })).toBeInTheDocument();
    expect(await axeViolations(arabic.container)).toEqual([]);
  });
});

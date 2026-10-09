import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreditsChip } from '@/components/layout/credits-chip';
import { UserProvider, useUser, type CurrentUser } from '@/lib/user-context';
import { renderUi } from '../render';

const user = (creditBalance: number): CurrentUser => ({
  id: 'usr_1',
  email: 'a@b.co',
  name: 'Layla',
  role: 'user',
  locale: 'en',
  creditBalance,
});

function SetBalance({ value }: { value: number }) {
  const { setCreditBalance } = useUser();
  return <button onClick={() => setCreditBalance(value)}>spend</button>;
}

function SignOut() {
  const { refresh } = useUser();
  return <button onClick={() => void refresh()}>expire</button>;
}

describe('CreditsChip', () => {
  it('shows nothing without a user, instead of an empty balance', () => {
    renderUi(
      <UserProvider initialUser={null}>
        <CreditsChip />
      </UserProvider>,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('leaves when the session ends while the page is open', async () => {
    const userEv = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'No session' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderUi(
        <UserProvider initialUser={user(12)}>
          <CreditsChip />
          <SignOut />
        </UserProvider>,
      );
      expect(screen.getByRole('link', { name: 'Credits: 12' })).toBeInTheDocument();
      await userEv.click(screen.getByRole('button', { name: 'expire' }));
      await waitFor(() => expect(screen.queryByRole('link')).not.toBeInTheDocument());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('links to the account page and names the balance, grouped for English', () => {
    renderUi(
      <UserProvider initialUser={user(1250)}>
        <CreditsChip />
      </UserProvider>,
    );
    const chip = screen.getByRole('link', { name: 'Credits: 1,250' });
    expect(chip).toHaveAttribute('href', '/account');
    expect(chip).toHaveTextContent('1,250');
  });

  it('uses Arabic-Indic digits and the Arabic label in Arabic', () => {
    renderUi(
      <UserProvider initialUser={user(1250)}>
        <CreditsChip />
      </UserProvider>,
      { locale: 'ar' },
    );
    expect(screen.getByRole('link', { name: 'الرصيد: ١٬٢٥٠' })).toHaveTextContent('١٬٢٥٠');
  });

  it('follows the live balance', async () => {
    const userEv = userEvent.setup();
    renderUi(
      <UserProvider initialUser={user(50)}>
        <CreditsChip />
        <SetBalance value={44} />
      </UserProvider>,
    );
    await userEv.click(screen.getByRole('button', { name: 'spend' }));
    expect(screen.getByRole('link', { name: 'Credits: 44' })).toHaveTextContent('44');
  });

  it('plays the bump animation only after the number changes, not on first paint', async () => {
    const userEv = userEvent.setup();
    renderUi(
      <UserProvider initialUser={user(50)}>
        <CreditsChip />
        <SetBalance value={44} />
      </UserProvider>,
    );
    expect(screen.getByText('50')).not.toHaveClass('animate-bump');
    await userEv.click(screen.getByRole('button', { name: 'spend' }));
    expect(screen.getByText('44')).toHaveClass('animate-bump');
  });

  it('warns when the balance is low and when it is empty', () => {
    const { unmount } = renderUi(
      <UserProvider initialUser={user(3)}>
        <CreditsChip />
      </UserProvider>,
    );
    expect(screen.getByRole('link', { name: 'Credits: 3. Running low' })).toHaveClass(
      'text-warning',
    );
    unmount();
    renderUi(
      <UserProvider initialUser={user(0)}>
        <CreditsChip />
      </UserProvider>,
    );
    expect(screen.getByRole('link', { name: 'Credits: 0. Running low' })).toHaveClass(
      'text-danger',
    );
  });
});

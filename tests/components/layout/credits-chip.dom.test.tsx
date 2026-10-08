import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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

describe('CreditsChip', () => {
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

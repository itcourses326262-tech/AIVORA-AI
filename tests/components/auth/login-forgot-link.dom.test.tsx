import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from '@/components/auth/login-form';
import { renderUi } from '../render';
import { router } from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/login' }));

describe('LoginForm: account recovery', () => {
  it('links to the forgot-password page from between the password and the button', () => {
    renderUi(<LoginForm next="/gallery" />);
    const link = screen.getByRole('link', { name: 'Forgot password?' });
    expect(link).toHaveAttribute('href', '/forgot-password');
    const password = screen.getByLabelText(/^Password/);
    const button = screen.getByRole('button', { name: 'Log in' });
    expect(password.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says it in Arabic too', () => {
    renderUi(<LoginForm next="/studio" />, { locale: 'ar' });
    expect(screen.getByRole('link', { name: 'نسيت كلمة المرور؟' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});

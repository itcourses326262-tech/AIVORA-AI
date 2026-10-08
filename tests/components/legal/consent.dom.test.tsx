import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterForm } from '@/components/auth/register-form';
import { CONSENT_LINE_ID, ConsentLine } from '@/components/legal/consent-line';
import { axeViolations } from '../axe';
import { router, stubFetch } from '../auth/support';
import { renderUi } from '../render';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/register' }));

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConsentLine', () => {
  it('says what creating an account means and links the terms and the privacy policy', () => {
    renderUi(<ConsentLine />);
    const line = document.getElementById(CONSENT_LINE_ID);
    expect(line?.textContent).toMatch(
      /^By creating an account, you agree to the Terms of Service .*and the Privacy Policy .*\.$/,
    );
    const terms = screen.getByRole('link', { name: /^Terms of Service/ });
    const privacy = screen.getByRole('link', { name: /^Privacy Policy/ });
    expect(terms).toHaveAttribute('href', '/terms');
    expect(privacy).toHaveAttribute('href', '/privacy');
  });

  it('opens the documents in a new tab, so the half-filled form stays, and says so to screen readers', () => {
    renderUi(<ConsentLine />);
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link).toHaveAccessibleName(/\(opens in a new tab\)$/);
    }
  });

  it('is written in Arabic with the links in the right places', () => {
    renderUi(<ConsentLine />, { locale: 'ar' });
    const line = document.getElementById(CONSENT_LINE_ID);
    expect(line?.textContent).toBe(
      'بإنشاء حسابك، فإنك توافق على شروط الخدمة (يُفتح في تبويب جديد) وسياسة الخصوصية (يُفتح في تبويب جديد).',
    );
    const terms = screen.getByRole('link', { name: /^شروط الخدمة/ });
    const privacy = screen.getByRole('link', { name: /^سياسة الخصوصية/ });
    expect(terms).toHaveAttribute('href', '/terms');
    expect(privacy).toHaveAttribute('href', '/privacy');
    // The "and" (و) is attached to the second link's label, outside of the link itself.
    expect(line?.textContent).toContain('شروط الخدمة (يُفتح في تبويب جديد) وسياسة');
  });

  it('has no accessibility violations in either language', async () => {
    const english = renderUi(<ConsentLine />);
    expect(await axeViolations(english.container)).toEqual([]);
    english.unmount();
    const arabic = renderUi(<ConsentLine />, { locale: 'ar' });
    expect(await axeViolations(arabic.container)).toEqual([]);
  });
});

describe('the register form', () => {
  const mount = (
    props: Partial<Parameters<typeof RegisterForm>[0]> = {},
    locale: 'ar' | 'en' = 'en',
  ) => renderUi(<RegisterForm next="/studio" bonus={50} signupOpen {...props} />, { locale });

  it('shows the consent line, with both links, above the submit button', () => {
    mount();
    const line = document.getElementById(CONSENT_LINE_ID);
    expect(line).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(line!.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(line!).getByRole('link', { name: /Terms of Service/ })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(within(line!).getByRole('link', { name: /Privacy Policy/ })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('describes the submit button by the consent line, so it is read out with the button', () => {
    mount();
    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(submit).toHaveAttribute('aria-describedby', CONSENT_LINE_ID);
    expect(submit).toHaveAccessibleDescription(/By creating an account, you agree to the Terms/);
  });

  it('shows it in Arabic', () => {
    mount({}, 'ar');
    expect(document.getElementById(CONSENT_LINE_ID)?.textContent).toContain(
      'بإنشاء حسابك، فإنك توافق على شروط الخدمة',
    );
  });

  it('does not change what is submitted: the consent text adds no field and no request', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 500 }));
    mount();
    expect(document.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
    await userEvent.setup().click(screen.getByRole('link', { name: /Terms of Service/ }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is not shown when sign-ups are closed (there is nothing to agree to)', () => {
    mount({ signupOpen: false });
    expect(document.getElementById(CONSENT_LINE_ID)).toBeNull();
  });
});

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { RedirectToLogin } from '@/components/layout/redirect-to-login';
import { SIDEBAR_COOKIE } from '@/components/layout/sidebar-cookie';
import { VerifyEmailBanner } from '@/components/layout/verify-email-banner';
import { getAppUser } from '@/lib/auth-guard';
import { getVerificationState } from '@/server/auth/verification';

export const metadata: Metadata = { robots: { index: false } };

/**
 * The signed-in area. Every page inside calls `requireUser(<its own path>)` first, which redirects
 * a visitor to `/login?next=…` on the server (a layout cannot know the path). This layout is the
 * safety net: without a user it renders a client-side redirect instead of the page, so content is
 * never shown to a visitor even if a page forgot its guard. With a user it renders the shell,
 * which owns `<main id="main-content">`.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [user, cookieStore] = await Promise.all([getAppUser(), cookies()]);
  if (!user) {
    return (
      <main id="main-content">
        <RedirectToLogin />
      </main>
    );
  }
  // While the server requires a confirmed email, an unconfirmed account sees why it cannot generate.
  const verification = getVerificationState(user.id);
  return (
    <AppShell
      initialUser={user}
      defaultCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === 'collapsed'}
    >
      {verification?.required && !verification.verified ? (
        <VerifyEmailBanner
          email={verification.email}
          bonusCredits={verification.bonusCredits}
          resendAfterSec={verification.resendAfterSec}
        />
      ) : null}
      {children}
    </AppShell>
  );
}

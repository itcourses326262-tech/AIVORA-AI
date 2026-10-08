import type { Metadata } from 'next';
import { firstParam } from '@/components/auth/search-params';
import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';
import { getOptionalUser } from '@/lib/auth-guard';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  // The address carries a secret: nothing on this page may hand it on in a Referer header.
  return { title: t('auth.verify.successTitle'), referrer: 'no-referrer' };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The page behind the link in the confirmation email. Rendering it changes nothing; the panel
 * confirms the address with a POST, so a mail scanner that only fetches the page cannot use up the
 * link. Works signed in or out (the link may be opened on another device).
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const token = firstParam((await searchParams).token);
  const user = await getOptionalUser();
  return <VerifyEmailPanel token={token ? token : null} signedIn={user !== null} />;
}

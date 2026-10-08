import type { Metadata } from 'next';
import { firstParam } from '@/components/auth/search-params';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  // The address carries a secret: nothing on this page may hand it on in a Referer header.
  return { title: t('auth.reset.title'), referrer: 'no-referrer' };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The page behind the link in the password-reset email. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const token = firstParam((await searchParams).token);
  return <ResetPasswordForm token={token ? token : null} />;
}

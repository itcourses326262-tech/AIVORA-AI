import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthAside } from '@/components/auth/auth-aside';
import { LoginForm } from '@/components/auth/login-form';
import { firstParam } from '@/components/auth/search-params';
import { getOptionalUser } from '@/lib/auth-guard';
import { getI18n } from '@/lib/i18n/server';
import { safeNextPath } from '@/lib/next-path';
import { firebaseWebConfig } from '@/server/auth/firebase';
import { getEnv } from '@/server/env';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('auth.login.submit') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Log in. Somebody who already is logged in goes straight on to where `?next=` points (only a
 * same-site path is ever followed, see `safeNextPath`), or to the studio.
 */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const next = safeNextPath(firstParam((await searchParams).next));
  if (await getOptionalUser()) redirect(next);
  const env = getEnv();
  return (
    <LoginForm
      next={next}
      aside={<AuthAside bonus={env.SIGNUP_BONUS_CREDITS} />}
      firebase={firebaseWebConfig(env)}
    />
  );
}

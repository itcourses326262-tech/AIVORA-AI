import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthAside } from '@/components/auth/auth-aside';
import { firstParam } from '@/components/auth/search-params';
import { RegisterForm } from '@/components/auth/register-form';
import { getOptionalUser } from '@/lib/auth-guard';
import { getI18n } from '@/lib/i18n/server';
import { safeNextPath } from '@/lib/next-path';
import { firebaseWebConfig } from '@/server/auth/firebase';
import { getEnv } from '@/server/env';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('auth.register.submit') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Create an account. Same redirect rules as the log in page. */
export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const next = safeNextPath(firstParam((await searchParams).next));
  if (await getOptionalUser()) redirect(next);
  const env = getEnv();
  return (
    <RegisterForm
      next={next}
      bonus={env.SIGNUP_BONUS_CREDITS}
      signupOpen={env.SIGNUP_ENABLED}
      aside={<AuthAside bonus={env.SIGNUP_BONUS_CREDITS} />}
      firebase={firebaseWebConfig(env)}
    />
  );
}

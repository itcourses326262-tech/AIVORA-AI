import type { Metadata } from 'next';
import { AccountView } from '@/components/account/account-view';
import { accountHref, parseAccountTab } from '@/components/account/tabs';
import { siteOrigin } from '@/components/marketing/seo';
import { requireUser } from '@/lib/auth-guard';
import { getI18n } from '@/lib/i18n/server';
import { API_KEY_NAME_MAX, MAX_ACTIVE_API_KEYS } from '@/server/auth/api-keys';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('account.title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The account area. `?tab=profile|security|credits|keys|data` opens a section (deep links from the
 * docs and the user menu); a visitor who follows such a link is sent to log in and brought back to
 * the same section.
 */
export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const tab = parseAccountTab((await searchParams).tab);
  await requireUser(accountHref(tab));
  return (
    <AccountView
      initialTab={tab}
      limits={{ maxActive: MAX_ACTIVE_API_KEYS, nameMax: API_KEY_NAME_MAX }}
      origin={siteOrigin()}
    />
  );
}

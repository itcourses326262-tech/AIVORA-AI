import type { Metadata } from 'next';
import { parsePrefill, studioHref } from '@/components/studio/prefill';
import { Studio } from '@/components/studio/studio';
import { requireUser } from '@/lib/auth-guard';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('studio.title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The studio. `?tool=`, `?model=`, `?prompt=` and `?input=<assetId>` prefill the form (the gallery
 * links here to reuse a prompt or to start from one of the user's own pictures); a visitor who
 * follows such a link is sent to log in and brought back to the same address.
 */
export default async function StudioPage({ searchParams }: { searchParams: SearchParams }) {
  const prefill = parsePrefill(await searchParams);
  await requireUser(studioHref(prefill));
  return <Studio prefill={prefill} />;
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { toPublicCreation, type PublicCreation } from '@/components/gallery/public-creation';
import { shareMetadata } from '@/components/gallery/share-meta';
import { ShareView } from '@/components/gallery/share-view';
import { SiteChrome } from '@/components/layout/site-chrome';
import { siteOrigin } from '@/components/marketing/seo';
import { getOptionalUser } from '@/lib/auth-guard';
import { getI18n } from '@/lib/i18n/server';
import { getPublicGeneration } from '@/server/generations/service';

type Params = Promise<{ id: string }>;

/**
 * The creation if it is public, finished and its owner's account is enabled; otherwise null,
 * whether it is private, deleted or never existed. Reduced to what the page shows right here, so
 * nothing else (the account's full name, the cost, the seed) can reach the markup.
 */
const loadShared = cache((id: string): PublicCreation | null => {
  const generation = getPublicGeneration(id);
  return generation && generation.outputs.length > 0 ? toPublicCreation(generation) : null;
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const [{ id }, i18n] = await Promise.all([params, getI18n()]);
  const creation = loadShared(id);
  // Nothing to index: Next adds `noindex` to the 404 page by itself.
  if (!creation) return { title: i18n.t('gallery.public.notFound.title') };
  return shareMetadata(creation, siteOrigin(), i18n);
}

/**
 * The public page of a shared creation. It is rendered per request (a creation can be unshared at
 * any moment) and answers a real 404 for anything that is not public, so a link to a creation
 * that was made private stops working at once. No `loading.tsx` sits above it on purpose: once
 * streaming has started the status could no longer change to 404.
 */
export default async function SharedCreationPage({ params }: { params: Params }) {
  const { id } = await params;
  const creation = loadShared(id);
  if (!creation) notFound();
  const [i18n, user] = await Promise.all([getI18n(), getOptionalUser()]);
  return (
    <SiteChrome>
      <ShareView creation={creation} origin={siteOrigin()} signedIn={user !== null} i18n={i18n} />
    </SiteChrome>
  );
}

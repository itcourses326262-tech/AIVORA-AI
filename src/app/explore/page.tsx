import type { Metadata, ResolvingMetadata } from 'next';
import { ExploreFeed } from '@/components/gallery/explore-feed';
import { ExploreKindNav } from '@/components/gallery/explore-kind-nav';
import { EXPLORE_PAGE_SIZE, exploreHref, parseExploreKind } from '@/components/gallery/explore';
import { toPublicCreation } from '@/components/gallery/public-creation';
import { SiteChrome } from '@/components/layout/site-chrome';
import { siteOrigin } from '@/components/marketing/seo';
import { Button } from '@/components/ui/button';
import { getOptionalUser } from '@/lib/auth-guard';
import { getI18n } from '@/lib/i18n/server';
import { listPublicGenerations } from '@/server/generations/service';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(
  { searchParams }: { searchParams: SearchParams },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const [{ t, locale }, kind] = await Promise.all([getI18n(), searchParams.then(parseExploreKind)]);
  const title = t('gallery.explore.meta.title');
  const description = t('gallery.explore.meta.description');
  const path = exploreHref(kind);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      url: new URL(path, siteOrigin()).href,
      siteName: t('common.app.name'),
      title,
      description,
      locale: locale === 'ar' ? 'ar_AR' : 'en_US',
      // A page's own `openGraph` replaces the inherited one: pass the share image on.
      images: (await parent).openGraph?.images,
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/**
 * The public feed of shared creations, open to everybody: a visitor sees the site header with the
 * log in and sign up buttons, a signed-in user their own menu. The first page is read on the
 * server (so it is in the HTML crawlers get), the next ones by "load more". Only what the cards
 * show leaves the server: the prompt, the model, the results and the owner's first name.
 */
export default async function ExplorePage({ searchParams }: { searchParams: SearchParams }) {
  const kind = parseExploreKind(await searchParams);
  const [{ t }, user, page] = await Promise.all([
    getI18n(),
    getOptionalUser(),
    listPublicGenerations({
      kind: kind === 'all' ? undefined : kind,
      limit: EXPLORE_PAGE_SIZE,
    }),
  ]);
  const items = page.data.map(toPublicCreation).filter((creation) => creation.outputs.length > 0);

  return (
    <SiteChrome>
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12"
      >
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {t('gallery.explore.title')}
            </h1>
            <p className="mt-2 max-w-xl text-muted">{t('gallery.explore.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ExploreKindNav kind={kind} />
            <Button href={user ? '/studio' : '/register?next=%2Fstudio'} variant="secondary">
              {t('gallery.public.create')}
            </Button>
          </div>
        </header>
        <ExploreFeed
          key={kind}
          kind={kind}
          initialItems={items}
          initialCursor={page.nextCursor}
          createHref={user ? '/studio' : '/register?next=%2Fstudio'}
          createLabel={t('gallery.public.create')}
        />
      </main>
    </SiteChrome>
  );
}

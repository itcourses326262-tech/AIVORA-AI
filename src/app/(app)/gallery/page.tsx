import type { Metadata } from 'next';
import { galleryHref, parseGalleryFilters } from '@/components/gallery/filters';
import { GalleryView } from '@/components/gallery/gallery-view';
import { requireUser } from '@/lib/auth-guard';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('gallery.title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The signed-in user's creations. The filters travel in the address (`?kind=&status=&favorite=&q=`),
 * so a filtered view survives a reload and a visitor who follows such a link logs in and comes
 * back to the same view. The list itself loads in the browser, page by page.
 */
export default async function GalleryPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseGalleryFilters(await searchParams);
  await requireUser(galleryHref(filters));
  return <GalleryView initialFilters={filters} />;
}

import type { Metadata } from 'next';
import { getLocale } from '@/lib/i18n/server';
import { LOCALES } from '@/lib/i18n/locales';
import { LEGAL_MESSAGE_KEY, LEGAL_PATHS, type LegalSlug } from '@/lib/legal';
import { documentOf } from './outline';

/**
 * `generateMetadata` of a legal page. Like the landing page, both languages live at one URL (cookie,
 * then Accept-Language), so the canonical and the language alternates all point at it. The root
 * layout adds the " · AIVORE" suffix and the share image.
 */
export async function legalMetadata(slug: LegalSlug): Promise<Metadata> {
  const text = documentOf(await getLocale(), LEGAL_MESSAGE_KEY[slug]);
  const path = LEGAL_PATHS[slug];
  return {
    title: text.metaTitle,
    description: text.metaDescription,
    alternates: {
      canonical: path,
      languages: { ...Object.fromEntries(LOCALES.map((code) => [code, path])), 'x-default': path },
    },
  };
}

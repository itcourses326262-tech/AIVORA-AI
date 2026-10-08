import type { Metadata } from 'next';
import { getI18n } from '@/lib/i18n/server';
import { LOCALES } from '@/lib/i18n/locales';
import { LEGAL_MESSAGE_KEY, LEGAL_PATHS, type LegalSlug } from '@/lib/legal';

/**
 * `generateMetadata` of a legal page. Like the landing page, both languages live at one URL (cookie,
 * then Accept-Language), so the canonical and the language alternates all point at it. The root
 * layout adds the " · AIVORE" suffix and the share image.
 */
export async function legalMetadata(slug: LegalSlug): Promise<Metadata> {
  const { t } = await getI18n();
  const document = LEGAL_MESSAGE_KEY[slug];
  const path = LEGAL_PATHS[slug];
  return {
    title: t(`legal.${document}.meta.title`),
    description: t(`legal.${document}.meta.description`),
    alternates: {
      canonical: path,
      languages: { ...Object.fromEntries(LOCALES.map((code) => [code, path])), 'x-default': path },
    },
  };
}

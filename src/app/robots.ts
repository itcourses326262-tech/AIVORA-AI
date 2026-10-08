import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/components/marketing/seo';

export const dynamic = 'force-dynamic';

/**
 * Crawlers may read the public site (landing, Explore, shared creations). The API and the pages
 * behind a login stay out. `/login` and `/register` are deliberately not blocked here: they carry
 * `noindex`, which a crawler can only see if it is allowed to fetch the page.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/studio', '/gallery', '/account'],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}

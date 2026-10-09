import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/components/marketing/seo';

export const dynamic = 'force-dynamic';

/**
 * Crawlers may read the public site (landing, Explore, shared creations). The API and the pages
 * behind a login stay out, except the media route: the share preview picture (`og:image`,
 * `twitter:image`) and the Explore thumbnails are `/api/v1/media/<id>`, and a crawler that applies
 * robots.txt to image fetches must be allowed to load them (the longer, more specific rule wins;
 * the route itself answers 404 for anything that is not shared). `/login` and `/register` are
 * deliberately not blocked here: they carry `noindex`, which a crawler can only see if it is
 * allowed to fetch the page.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/api/v1/media/'],
        disallow: ['/api/', '/studio', '/gallery', '/account'],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}

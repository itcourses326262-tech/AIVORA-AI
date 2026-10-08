import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/components/marketing/seo';

// The origin comes from APP_URL at run time, not from whatever the build machine had.
export const dynamic = 'force-dynamic';

/**
 * The public pages worth indexing. Everything behind a login (studio, gallery, account), the auth
 * pages (they are `noindex`) and the API are left out. Languages share one URL (cookie, then
 * Accept-Language), so there is one entry per page.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return [
    { url: `${origin}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${origin}/explore`, changeFrequency: 'daily', priority: 0.8 },
  ];
}

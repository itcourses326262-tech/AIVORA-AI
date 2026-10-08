import type { ReactNode } from 'react';
import { SiteChrome } from '@/components/layout/site-chrome';

/** Public pages: header and footer around the page, which renders its own `<main id="main-content">`. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>;
}

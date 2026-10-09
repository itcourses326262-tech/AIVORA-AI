import type { Metadata } from 'next';
import { DocsPage } from '@/components/docs/docs-page';
import { pickQuickstartModel } from '@/components/docs/quickstart-model';
import { SiteChrome } from '@/components/layout/site-chrome';
import { siteOrigin } from '@/components/marketing/seo';
import { getI18n } from '@/lib/i18n/server';
import { buildOpenApiDocument } from '@/lib/openapi/spec';
import { listModelDTOs } from '@/app/api/v1/models/dto';
import { getEnv } from '@/server/env';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('account.docs.meta.title'),
    description: t('account.docs.meta.description'),
    alternates: { canonical: '/docs' },
  };
}

/**
 * The public API documentation. Anyone may read it, so it sits outside the signed-in area and
 * wears the site header and footer. It is rendered per request: the base URL and the model in
 * the quickstart depend on the deployment, the language of the text on the reader.
 */
export default async function DocsRoute() {
  const i18n = await getI18n();
  const origin = siteOrigin();
  return (
    <SiteChrome>
      <DocsPage
        i18n={i18n}
        document={buildOpenApiDocument(origin)}
        origin={origin}
        quickstart={pickQuickstartModel(listModelDTOs(getEnv()))}
      />
    </SiteChrome>
  );
}

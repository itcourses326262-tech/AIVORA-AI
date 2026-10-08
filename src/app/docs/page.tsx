import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { DocsPage } from '@/components/docs/docs-page';
import { pickQuickstartModel } from '@/components/docs/quickstart-model';
import { CODE_LANGUAGE_COOKIE, isQuickstartLanguage } from '@/components/docs/snippets';
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
 * wears the site header and footer. It is rendered per request: the base URL, the models in the
 * quickstart and the language of the code samples all depend on the deployment and the reader.
 */
export default async function DocsRoute() {
  const [i18n, cookieStore] = await Promise.all([getI18n(), cookies()]);
  const origin = siteOrigin();
  const saved = cookieStore.get(CODE_LANGUAGE_COOKIE)?.value;
  return (
    <SiteChrome>
      <DocsPage
        i18n={i18n}
        document={buildOpenApiDocument(origin)}
        origin={origin}
        quickstart={pickQuickstartModel(listModelDTOs(getEnv()))}
        initialLanguage={isQuickstartLanguage(saved) ? saved : 'bash'}
      />
    </SiteChrome>
  );
}

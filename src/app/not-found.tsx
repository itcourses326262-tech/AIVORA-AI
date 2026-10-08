import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { StatusPage } from '@/components/marketing/status-page';
import { Button } from '@/components/ui/button';
import { Directional } from '@/components/ui/icon';
import { getI18n } from '@/lib/i18n/server';
import { formatPlainNumber } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('landing.status.notFound.title'), robots: { index: false } };
}

/** Any URL that matches no page. Next answers with status 404. */
export default async function NotFound() {
  const { t, locale } = await getI18n();
  return (
    <StatusPage
      homeLabel={t('common.a11y.home')}
      mark={
        <span className="text-gradient-brand text-5xl font-semibold tabular-nums sm:text-6xl">
          {formatPlainNumber(404, locale)}
        </span>
      }
      eyebrow={t('landing.status.notFound.eyebrow')}
      title={t('landing.status.notFound.title')}
      description={t('landing.status.notFound.description')}
      actions={
        <>
          <Button
            href="/"
            size="lg"
            endIcon={
              <Directional>
                <ArrowRight className="size-5" />
              </Directional>
            }
          >
            {t('landing.status.home')}
          </Button>
          <Button href="/studio" size="lg" variant="secondary">
            {t('landing.status.studio')}
          </Button>
          <Button href="/explore" size="lg" variant="ghost">
            {t('landing.status.explore')}
          </Button>
        </>
      }
    />
  );
}

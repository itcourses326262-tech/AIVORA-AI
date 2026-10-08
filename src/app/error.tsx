'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { StatusPage, STATUS_TITLE_ID } from '@/components/marketing/status-page';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/components/ui/error-message';
import { errorCodeOf } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/client';

/**
 * What a visitor sees when a page throws while rendering. Next passes the error (in production
 * only a `digest`, never the message) and `reset`, which tries to render the segment again.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  // The page content was replaced: bring screen reader and keyboard users to the new message.
  useEffect(() => {
    document.getElementById(STATUS_TITLE_ID)?.focus();
  }, []);

  return (
    <>
      <title>{t('landing.status.error.title')}</title>
      <StatusPage
        homeLabel={t('common.a11y.home')}
        mark={<TriangleAlert className="size-14 text-danger" strokeWidth={1.5} />}
        eyebrow={t('landing.status.error.eyebrow')}
        title={t('landing.status.error.title')}
        // A failure that carries a code the visitor can act on (offline, rate limited) says so; anything else gets the general text.
        description={
          errorCodeOf(error) === 'internal'
            ? t('landing.status.error.description')
            : errorMessage(t, error)
        }
        reference={
          error.digest ? t('landing.status.error.reference', { digest: error.digest }) : undefined
        }
        actions={
          <>
            <Button size="lg" startIcon={<RefreshCw className="size-5" />} onClick={reset}>
              {t('common.actions.retry')}
            </Button>
            <Button href="/" size="lg" variant="secondary">
              {t('landing.status.home')}
            </Button>
          </>
        }
      />
    </>
  );
}

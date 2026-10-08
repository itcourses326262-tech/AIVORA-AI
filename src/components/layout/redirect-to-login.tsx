'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { loginUrl } from '@/lib/next-path';
import { Spinner } from '../ui/spinner';

/**
 * The fallback of the `(app)` layout for a visitor: it sends the browser to the log in page and
 * remembers where it was (`?next=`). Pages normally redirect on the server first, with
 * `requireUser()`; this covers a page that forgot to, without ever rendering its content.
 */
export function RedirectToLogin() {
  const { t } = useI18n();
  const router = useRouter();
  useEffect(() => {
    router.replace(loginUrl(`${window.location.pathname}${window.location.search}`));
  }, [router]);
  return (
    <div
      role="status"
      className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 p-6 text-muted"
    >
      <Spinner label={t('auth.guard.redirecting')} />
      <p className="text-sm">{t('auth.guard.redirecting')}</p>
    </div>
  );
}

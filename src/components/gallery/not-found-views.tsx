import { ImageOff, LockKeyhole } from 'lucide-react';
import type { ReactNode } from 'react';
import { SiteChrome } from '@/components/layout/site-chrome';
import { getI18n } from '@/lib/i18n/server';
import { Button } from '../ui/button';

interface NotFoundPanelProps {
  icon: ReactNode;
  title: string;
  description: string;
  actions: ReactNode;
}

/** A missing page, said kindly: what is missing, why that may be, and where to go instead. */
function NotFoundPanel({ icon, title, description, actions }: NotFoundPanelProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-16 text-center sm:py-24">
      <span
        aria-hidden="true"
        className="mb-1 flex size-16 items-center justify-center rounded-3xl border border-border bg-surface-raised text-brand shadow-sm [&_svg]:size-7"
      >
        {icon}
      </span>
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm leading-6 text-muted">{description}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{actions}</div>
    </div>
  );
}

/**
 * `/gallery/<id>` for an id that is not the signed-in user's (missing and someone else's look the
 * same on purpose). It renders inside the app shell, which owns the `<main>`.
 */
export async function CreationNotFound() {
  const { t } = await getI18n();
  return (
    <NotFoundPanel
      icon={<ImageOff />}
      title={t('gallery.detail.notFound.title')}
      description={t('gallery.detail.notFound.description')}
      actions={<Button href="/gallery">{t('gallery.detail.notFound.action')}</Button>}
    />
  );
}

/** `/s/<id>` for a creation that is private, deleted or never existed (the page answers 404). */
export async function ShareNotFound() {
  const { t } = await getI18n();
  return (
    <SiteChrome>
      <main id="main-content" className="flex flex-1 flex-col justify-center">
        <NotFoundPanel
          icon={<LockKeyhole />}
          title={t('gallery.public.notFound.title')}
          description={t('gallery.public.notFound.description')}
          actions={
            <>
              <Button href="/explore">{t('gallery.public.notFound.explore')}</Button>
              <Button href="/studio" variant="secondary">
                {t('gallery.public.create')}
              </Button>
            </>
          }
        />
      </main>
    </SiteChrome>
  );
}

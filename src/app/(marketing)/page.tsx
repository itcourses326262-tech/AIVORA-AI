// OWNER: ui-kit — replace this placeholder with the landing page
import { getI18n } from '@/lib/i18n/server';

export default async function HomePage() {
  const { t } = await getI18n();
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-4 px-6"
    >
      <h1 className="text-5xl font-bold">{t('common.app.name')}</h1>
      <p className="text-lg text-muted">{t('common.app.tagline')}</p>
    </main>
  );
}

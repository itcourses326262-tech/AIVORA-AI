import Link from 'next/link';
import { getI18n } from '@/lib/i18n/server';
import { LEGAL_MESSAGE_KEY, LEGAL_PATHS, LEGAL_SLUGS } from '@/lib/legal';
import { Logo } from '../ui/logo';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';

const linkClass =
  'inline-flex w-fit items-center rounded-sm py-1.5 text-sm text-muted transition-colors duration-150 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:py-0';

/** The public site footer. `signedIn` swaps the account column's sign-in links for the account ones. */
export async function SiteFooter({ signedIn = false }: { signedIn?: boolean }) {
  const { t } = await getI18n();
  const year = new Date().getUTCFullYear();
  return (
    <footer className="border-t border-border bg-surface/40">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-x-10">
        <div className="col-span-2 grid content-start gap-4 md:col-span-1">
          <Link
            href="/"
            aria-label={t('common.a11y.home')}
            className="hit-area w-fit rounded-lg text-foreground"
          >
            <Logo label={null} className="h-7" />
          </Link>
          <p className="max-w-xs text-sm text-muted">{t('landing.footer.tagline')}</p>
        </div>
        <nav aria-label={t('landing.footer.product')} className="grid content-start gap-1">
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            {t('landing.footer.product')}
          </h2>
          <Link href="/studio" className={linkClass}>
            {t('common.nav.studio')}
          </Link>
          <Link href="/explore" className={linkClass}>
            {t('common.nav.explore')}
          </Link>
          <Link href="/docs" className={linkClass}>
            {t('common.nav.docs')}
          </Link>
        </nav>
        <nav aria-label={t('landing.footer.account')} className="grid content-start gap-1">
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            {t('landing.footer.account')}
          </h2>
          {signedIn ? (
            <>
              <Link href="/gallery" className={linkClass}>
                {t('common.nav.gallery')}
              </Link>
              <Link href="/account" className={linkClass}>
                {t('common.nav.account')}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className={linkClass}>
                {t('common.nav.login')}
              </Link>
              <Link href="/register" className={linkClass}>
                {t('common.nav.register')}
              </Link>
            </>
          )}
        </nav>
        <nav
          aria-label={t('legal.footer.title')}
          className="col-span-2 grid content-start gap-1 md:col-span-1"
        >
          <h2 className="mb-2 text-sm font-semibold text-foreground">{t('legal.footer.title')}</h2>
          <div className="grid grid-cols-2 gap-x-6 md:grid-cols-1">
            {LEGAL_SLUGS.map((slug) => (
              <Link key={slug} href={LEGAL_PATHS[slug]} className={linkClass}>
                {t(`legal.nav.${LEGAL_MESSAGE_KEY[slug]}`)}
              </Link>
            ))}
          </div>
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <p className="text-xs text-subtle">{t('landing.footer.rights', { year })}</p>
          <div className="flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}

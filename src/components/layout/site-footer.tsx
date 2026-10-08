import Link from 'next/link';
import { getI18n } from '@/lib/i18n/server';
import { Logo } from '../ui/logo';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';

const linkClass =
  'rounded-sm text-sm text-muted transition-colors duration-150 hover:text-foreground';

/** The public site footer. `signedIn` swaps the account column's sign-in links for the account ones. */
export async function SiteFooter({ signedIn = false }: { signedIn?: boolean }) {
  const { t } = await getI18n();
  const year = new Date().getUTCFullYear();
  return (
    <footer className="border-t border-border bg-surface/40">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="grid content-start gap-4">
          <Link
            href="/"
            aria-label={t('common.a11y.home')}
            className="w-fit rounded-lg text-foreground"
          >
            <Logo label={null} className="h-7" />
          </Link>
          <p className="max-w-xs text-sm text-muted">{t('landing.footer.tagline')}</p>
        </div>
        <nav aria-label={t('landing.footer.product')} className="grid content-start gap-3">
          <h2 className="text-sm font-semibold text-foreground">{t('landing.footer.product')}</h2>
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
        <nav aria-label={t('landing.footer.account')} className="grid content-start gap-3">
          <h2 className="text-sm font-semibold text-foreground">{t('landing.footer.account')}</h2>
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

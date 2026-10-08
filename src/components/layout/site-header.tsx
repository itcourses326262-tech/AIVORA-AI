'use client';

import { ArrowRight, Menu, Monitor, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { THEMES } from '@/lib/theme';
import { LOCALES } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { buttonVariants } from '../ui/button-variants';
import { Directional } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { Logo } from '../ui/logo';
import { SegmentedControl } from '../ui/radio-group';
import { Separator } from '../ui/separator';
import { Sheet } from '../ui/sheet';
import { CreditsChip } from './credits-chip';
import { LocaleSwitcher } from './locale-switcher';
import { isActivePath, SITE_NAV } from './nav';
import { useLocaleSwitch, useThemeSwitch } from './preferences';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

function subscribeToScroll(onChange: () => void): () => void {
  window.addEventListener('scroll', onChange, { passive: true });
  return () => window.removeEventListener('scroll', onChange);
}

/** True once the page has scrolled a little: the header then gets its frosted background. */
function useScrolled(): boolean {
  return useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > 8,
    () => false,
  );
}

function MobileMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { user } = useUser();
  const { locale, setLocale } = useLocaleSwitch();
  const { theme, setTheme } = useThemeSwitch();
  const close = () => onOpenChange(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      side="end"
      title={t('common.a11y.mobileNavigation')}
      hideTitle
    >
      <nav aria-label={t('common.a11y.mobileNavigation')} className="grid gap-1">
        {SITE_NAV.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-12 items-center gap-3 rounded-xl px-3 text-base font-medium transition-colors duration-150',
                active
                  ? 'bg-brand-soft text-foreground'
                  : 'text-muted hover:bg-foreground/[0.06] hover:text-foreground',
              )}
            >
              <item.icon aria-hidden="true" className={cn('size-5', active && 'text-brand')} />
              {t(item.label)}
            </Link>
          );
        })}
      </nav>
      <Separator className="my-4" />
      <div className="grid gap-4">
        <div className="grid gap-2">
          <p id="mobile-language-label" className="text-xs font-medium text-subtle">
            {t('common.language.label')}
          </p>
          <SegmentedControl
            fullWidth
            aria-labelledby="mobile-language-label"
            value={locale}
            onValueChange={setLocale}
            options={LOCALES.map((code) => ({
              value: code,
              label: <span lang={code}>{t(`common.language.${code}`)}</span>,
            }))}
          />
        </div>
        <div className="grid gap-2">
          <p id="mobile-theme-label" className="text-xs font-medium text-subtle">
            {t('common.theme.label')}
          </p>
          <SegmentedControl
            fullWidth
            aria-labelledby="mobile-theme-label"
            value={theme}
            onValueChange={setTheme}
            options={THEMES.map((name) => {
              const Icon = THEME_ICONS[name];
              return {
                value: name,
                label: (
                  <>
                    <Icon aria-hidden="true" />
                    {t(`common.theme.${name}`)}
                  </>
                ),
              };
            })}
          />
        </div>
      </div>
      {user ? null : (
        <div className="mt-6 grid gap-2">
          <Button href="/register" size="lg" fullWidth onClick={close}>
            {t('common.nav.register')}
          </Button>
          <Button href="/login" variant="secondary" size="lg" fullWidth onClick={close}>
            {t('common.nav.login')}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/**
 * The public site header: logo, navigation, language and theme switchers and either the sign-in
 * buttons or the account menu. Sticky; it turns frosted once the page scrolls. Below `lg` (phones
 * and tablets) the navigation and the switchers move into a sheet: with the longer Arabic labels
 * the full row does not fit a portrait tablet.
 */
export function SiteHeader() {
  const { t } = useI18n();
  const pathname = usePathname();
  const { user } = useUser();
  const scrolled = useScrolled();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header
      data-scrolled={scrolled}
      className="sticky top-0 z-40 border-b border-transparent transition-[background-color,border-color,backdrop-filter] duration-200 data-[scrolled=true]:border-border data-[scrolled=true]:surface-glass"
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          aria-label={t('common.a11y.home')}
          className="hit-area -m-1 shrink-0 rounded-lg p-1 text-foreground"
        >
          <Logo label={null} className="h-6 sm:h-7" />
        </Link>

        <nav
          aria-label={t('common.a11y.mainNavigation')}
          className="ms-6 hidden items-center gap-1 lg:flex"
        >
          {SITE_NAV.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150',
                  active
                    ? 'text-foreground'
                    : 'text-muted hover:bg-foreground/[0.06] hover:text-foreground',
                )}
              >
                {t(item.label)}
              </Link>
            );
          })}
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-1.5">
          <div className="hidden items-center gap-1 lg:flex">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
          {user ? (
            <>
              <CreditsChip className="hidden sm:inline-flex" />
              <UserMenu preferences={false} />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'md' }),
                  'hidden lg:inline-flex',
                )}
              >
                {t('common.nav.login')}
              </Link>
              <Button
                href="/register"
                size="sm"
                className="lg:h-10 lg:rounded-lg lg:px-4"
                endIcon={
                  <Directional className="hidden sm:inline-flex">
                    <ArrowRight className="size-4" />
                  </Directional>
                }
              >
                {t('common.nav.register')}
              </Button>
            </>
          )}
          <IconButton
            label={t('common.a11y.openMenu')}
            className="lg:hidden"
            tooltip={false}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Menu />
          </IconButton>
        </div>
      </div>
      <MobileMenu open={menuOpen} onOpenChange={setMenuOpen} />
    </header>
  );
}

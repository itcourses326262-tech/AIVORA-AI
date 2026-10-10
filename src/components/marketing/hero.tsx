import { ArrowRight, Gift, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Directional } from '@/components/ui/icon';
import type { Translator } from '@/lib/i18n';
import { creditsLabel } from './credits-label';
import { MeshBackdrop } from './mesh-backdrop';

const JUMP_LINKS = [
  { href: '#features', label: 'landing.nav.features' },
  { href: '#how-it-works', label: 'landing.nav.how' },
  { href: '#credits', label: 'landing.nav.credits' },
  { href: '#api', label: 'landing.nav.api' },
  { href: '#faq', label: 'landing.nav.faq' },
] as const;

export interface HeroProps {
  i18n: Translator;
  /** Free credits a visitor can earn by signing up with Google (0 leaves the promise, and its icon, out). */
  bonus: number;
}

export function Hero({ i18n, bonus }: HeroProps) {
  const { t } = i18n;
  return (
    // The backdrop runs up behind the (transparent) site header, so there is no seam where it starts.
    <section
      aria-labelledby="hero-title"
      className="relative isolate -mt-(--header-height) overflow-hidden pt-(--header-height)"
    >
      <MeshBackdrop />
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 pt-14 pb-10 text-center sm:px-6 sm:pt-24 sm:pb-14">
        <p className="inline-flex max-w-full items-center gap-2 rounded-full border border-brand/30 bg-brand-soft py-1.5 ps-3 pe-4 text-sm font-medium text-brand shadow-xs backdrop-blur">
          <Sparkles aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{t('landing.hero.badge')}</span>
        </p>

        <h1
          id="hero-title"
          className="mt-7 max-w-4xl text-[2rem] leading-[1.1] font-semibold tracking-tight text-foreground sm:text-6xl lg:text-7xl rtl:leading-[1.3] rtl:font-bold rtl:max-sm:text-[1.75rem]"
        >
          <span className="block">{t('landing.hero.title')}</span>{' '}
          <span className="block text-gradient-brand">{t('landing.hero.titleAccent')}</span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg text-muted sm:text-xl">{t('landing.hero.subtitle')}</p>

        <div className="mt-9 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Button
            href="/register"
            size="lg"
            className="sm:min-w-52"
            endIcon={
              <Directional>
                <ArrowRight className="size-5" />
              </Directional>
            }
          >
            {t('landing.hero.cta')}
          </Button>
          <Button href="/explore" size="lg" variant="secondary" className="sm:min-w-44">
            {t('landing.hero.ctaSecondary')}
          </Button>
        </div>

        <p className="mt-5 max-w-sm text-sm text-muted sm:max-w-none">
          {bonus > 0 ? (
            <Gift aria-hidden="true" className="me-2 -mt-0.5 inline size-4 text-accent" />
          ) : null}
          {bonus > 0
            ? t('landing.hero.trust', { credits: creditsLabel(i18n, bonus) })
            : t('landing.hero.trustNoBonus')}
        </p>

        <nav aria-label={t('landing.nav.label')} className="mt-10 w-full sm:w-auto">
          <ul className="-mx-4 no-scrollbar flex items-center gap-2 overflow-x-auto edge-fade px-4 py-1 sm:mx-0 sm:gap-1 sm:rounded-full sm:border sm:border-border sm:bg-surface/60 sm:p-1 sm:backdrop-blur">
            {JUMP_LINKS.map((link) => (
              <li key={link.href} className="shrink-0">
                <a
                  href={link.href}
                  className="inline-flex h-9 items-center rounded-full border border-border bg-surface/60 px-3.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-foreground/[0.07] hover:text-foreground sm:border-transparent sm:bg-transparent pointer-coarse:h-11"
                >
                  {t(link.label)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}

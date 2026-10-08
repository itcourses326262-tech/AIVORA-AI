import { ArrowRight, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Directional } from '@/components/ui/icon';
import type { Translator } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { creditsLabel } from './credits-label';
import { MeshBackdrop } from './mesh-backdrop';
import styles from './marketing.module.css';

export function FinalCta({ i18n, bonus }: { i18n: Translator; bonus: number }) {
  const { t } = i18n;
  return (
    <section aria-labelledby="final-cta-title">
      <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-20 sm:px-6 sm:pb-28">
        <div
          className={cn(
            'relative isolate overflow-hidden rounded-3xl px-6 py-14 text-center shadow-lg border-gradient-brand sm:px-12 sm:py-20',
            styles.reveal,
          )}
        >
          <MeshBackdrop />
          <h2
            id="final-cta-title"
            className="mx-auto max-w-2xl text-3xl leading-tight font-semibold tracking-tight text-foreground sm:text-5xl rtl:leading-snug rtl:font-bold"
          >
            {t('landing.finalCta.title')}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted sm:text-lg">
            {t('landing.finalCta.description')}
          </p>
          <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
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
          <p className="mt-5 flex items-center justify-center gap-2 text-sm text-muted">
            <Gift aria-hidden="true" className="size-4 shrink-0 text-accent" />
            <span>
              {bonus > 0
                ? t('landing.hero.trust', { credits: creditsLabel(i18n, bonus) })
                : t('landing.hero.trustNoBonus')}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

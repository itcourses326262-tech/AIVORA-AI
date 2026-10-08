import { Images, PenLine, Zap, type LucideIcon } from 'lucide-react';
import type { MessageKey, Translator } from '@/lib/i18n';
import { cn, formatNumber } from '@/lib/utils';
import { Section, SectionHeader } from './section';
import styles from './marketing.module.css';

const STEPS: ReadonlyArray<{
  icon: LucideIcon;
  title: MessageKey;
  description: MessageKey;
}> = [
  {
    icon: PenLine,
    title: 'landing.how.steps.describe.title',
    description: 'landing.how.steps.describe.description',
  },
  {
    icon: Zap,
    title: 'landing.how.steps.generate.title',
    description: 'landing.how.steps.generate.description',
  },
  {
    icon: Images,
    title: 'landing.how.steps.keep.title',
    description: 'landing.how.steps.keep.description',
  },
];

export function HowItWorks({ i18n }: { i18n: Translator }) {
  const { t, locale } = i18n;
  return (
    <Section id="how-it-works" tone="muted">
      <SectionHeader
        id="how-it-works"
        eyebrow={t('landing.how.eyebrow')}
        title={t('landing.how.title')}
      />
      <div className={cn('relative mt-14', styles.reveal)}>
        <div
          aria-hidden="true"
          className="absolute inset-x-[16.66%] top-7 hidden border-t border-dashed border-border-strong md:block"
        />
        <ol className="relative grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, index) => (
            <li key={step.title} className="grid justify-items-center gap-4 text-center">
              <span className="relative flex size-14 items-center justify-center rounded-2xl shadow-md border-gradient-brand">
                <step.icon aria-hidden="true" className="size-6 text-brand" />
                <span
                  aria-hidden="true"
                  className="absolute -end-2 -top-2 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums shadow-sm"
                >
                  {formatNumber(index + 1, locale)}
                </span>
              </span>
              <div className="grid max-w-xs gap-2">
                <p className="sr-only">{t('landing.how.step', { number: index + 1 })}</p>
                <h3 className="text-lg font-semibold text-foreground rtl:font-bold">
                  {t(step.title)}
                </h3>
                <p className="text-sm leading-relaxed text-muted">{t(step.description)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

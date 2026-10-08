import { Plus } from 'lucide-react';
import type { MessageKey, Translator } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Section, SectionHeader } from './section';
import styles from './marketing.module.css';

export const FAQ_KEYS = ['free', 'arabic', 'credit', 'privacy', 'models', 'developers'] as const;
export type FaqKey = (typeof FAQ_KEYS)[number];

export interface FaqEntry {
  key: FaqKey;
  question: string;
  answer: string;
}

export function faqEntries({ t }: Pick<Translator, 't'>): FaqEntry[] {
  return FAQ_KEYS.map((key) => ({
    key,
    question: t(`landing.faq.items.${key}.question` satisfies MessageKey),
    answer: t(`landing.faq.items.${key}.answer` satisfies MessageKey),
  }));
}

/**
 * Native disclosure widgets: the browser provides the keyboard behaviour (Enter and Space toggle),
 * the expanded state for assistive technology, find-in-page that opens the answer, and it all
 * works without a line of script. Sharing the `name` makes it an accordion (one answer open).
 */
export function Faq({ i18n }: { i18n: Translator }) {
  const { t } = i18n;
  return (
    <Section id="faq">
      <SectionHeader id="faq" eyebrow={t('landing.faq.eyebrow')} title={t('landing.faq.title')} />
      <div
        className={cn(
          'mx-auto mt-12 max-w-3xl divide-y divide-border rounded-2xl border border-border bg-surface shadow-xs',
          styles.reveal,
        )}
      >
        {faqEntries(i18n).map((entry, index) => (
          <details key={entry.key} name="faq" open={index === 0} className="group px-5 sm:px-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-5 text-start marker:hidden [&::-webkit-details-marker]:hidden">
              <h3 className="text-base font-medium text-foreground rtl:font-semibold">
                {entry.question}
              </h3>
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-[transform,background-color,color] duration-200 group-open:rotate-45 group-open:bg-brand-soft group-open:text-brand group-hover:text-foreground"
              >
                <Plus className="size-4" />
              </span>
            </summary>
            <p className="animate-fade-in pb-5 text-sm leading-relaxed text-muted sm:text-base">
              {entry.answer}
            </p>
          </details>
        ))}
      </div>
    </Section>
  );
}

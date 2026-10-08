import { Clapperboard, Gift, Languages, WandSparkles, type LucideIcon } from 'lucide-react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { ShowcaseArt } from '@/components/marketing/showcase-art';
import { SHOWCASE_ITEMS } from '@/components/marketing/showcase-data';
import { getI18n } from '@/lib/i18n/server';

const SAMPLE = SHOWCASE_ITEMS.find((item) => item.id === 'arches') ?? SHOWCASE_ITEMS[0]!;

/**
 * What the account is for, on wide screens only: a benefits panel beside the form card and a
 * sample artwork on its other side. The auth layout centres a single card, so both are placed
 * relative to the form's own box and hang outside the card (the card is 2rem padded, hence the
 * 4.5rem offset: that padding plus a 2.5rem gap). Below `xl` the panel is hidden and the register
 * form shows its own, shorter benefits list instead, so exactly one is ever visible. A server
 * component: the pages render it and hand it to the (client) form as its `aside`.
 */
export async function AuthAside({ bonus }: { bonus: number }) {
  const i18n = await getI18n();
  const { t } = i18n;
  const items: Array<{ icon: LucideIcon; text: string }> = [
    ...(bonus > 0
      ? [
          {
            icon: Gift,
            text: t('auth.register.benefits.credits', { credits: creditsLabel(i18n, bonus) }),
          },
        ]
      : []),
    { icon: Languages, text: t('auth.register.benefits.languages') },
    { icon: Clapperboard, text: t('auth.register.benefits.studio') },
    { icon: WandSparkles, text: t('auth.panel.enhancer') },
  ];
  return (
    <>
      <aside
        aria-labelledby="auth-panel-title"
        className="absolute end-[calc(100%+4.5rem)] top-0 hidden w-72 gap-5 rounded-3xl border border-border bg-surface/60 p-6 shadow-md backdrop-blur-xl xl:grid"
      >
        <h2
          id="auth-panel-title"
          className="text-gradient-brand pb-1 text-xl leading-snug font-semibold rtl:font-bold"
        >
          {t('auth.panel.title')}
        </h2>
        <ul className="grid gap-3.5 text-sm text-foreground">
          {items.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
              >
                <Icon className="size-4" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </aside>
      <figure
        aria-hidden="true"
        className="absolute start-[calc(100%+4.5rem)] top-0 hidden w-60 rotate-3 overflow-hidden rounded-3xl border border-border shadow-lg xl:block rtl:-rotate-3"
      >
        <ShowcaseArt
          art={SAMPLE.art}
          size="square"
          palette={SAMPLE.palette}
          uid="auth-sample"
          className="aspect-[4/5] w-full"
        />
        <figcaption className="absolute inset-x-3 bottom-3 rounded-xl border border-white/15 bg-black/60 p-3 text-xs leading-relaxed text-white backdrop-blur-md">
          {t(SAMPLE.prompt)}
        </figcaption>
      </figure>
    </>
  );
}

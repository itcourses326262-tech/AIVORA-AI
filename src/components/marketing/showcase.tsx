import {
  Clapperboard,
  Image as ImageIcon,
  ImagePlay,
  ImagePlus,
  Play,
  type LucideIcon,
} from 'lucide-react';
import type { Tool } from '@/lib/catalog/types';
import type { MessageKey, Translator } from '@/lib/i18n';
import { cn, formatSeconds } from '@/lib/utils';
import { Section, SectionHeader } from './section';
import { ShowcaseArt } from './showcase-art';
import { SHOWCASE_ITEMS, type ShowcaseItem, type ShowcaseSize } from './showcase-data';
import styles from './marketing.module.css';

const SIZE_CLASSES: Record<ShowcaseSize, string> = {
  hero: 'col-span-2 row-span-2',
  tall: 'row-span-2',
  wide: 'col-span-2',
  square: '',
};

const TOOL_ICON: Record<Tool, LucideIcon> = {
  'text-to-image': ImageIcon,
  'image-to-image': ImagePlus,
  'text-to-video': Clapperboard,
  'image-to-video': ImagePlay,
};

const TOOL_NAME: Record<Tool, MessageKey> = {
  'text-to-image': 'common.tools.textToImage.name',
  'image-to-image': 'common.tools.imageToImage.name',
  'text-to-video': 'common.tools.textToVideo.name',
  'image-to-video': 'common.tools.imageToVideo.name',
};

function SampleCard({ item, i18n }: { item: ShowcaseItem; i18n: Translator }) {
  const { t, locale } = i18n;
  const isVideo = item.kind === 'video';
  const ToolIcon = TOOL_ICON[item.tool];
  const featured = item.size === 'hero';
  return (
    <figure
      className={cn(
        'group relative isolate overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-md transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-lg',
        SIZE_CLASSES[item.size],
      )}
    >
      <ShowcaseArt
        art={item.art}
        size={item.size}
        palette={item.palette}
        uid={`sample-${item.id}`}
        moving={isVideo}
        className="absolute inset-0 size-full transition-transform duration-700 ease-out group-hover:scale-[1.04]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-t from-black/80 via-black/15 to-transparent"
      />

      <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-white/20 bg-black/60 py-1 ps-2 pe-2.5 text-xs font-medium text-white backdrop-blur-md">
          <ToolIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="sr-only">{t(TOOL_NAME[item.tool])}: </span>
          <span dir="ltr" className="truncate">
            {item.model}
          </span>
        </span>
        {isVideo && item.seconds !== undefined ? (
          <span className="shrink-0 rounded-full border border-white/20 bg-black/60 px-2 py-1 text-xs font-medium whitespace-nowrap text-white backdrop-blur-md">
            {formatSeconds(item.seconds, locale)}
          </span>
        ) : null}
      </div>

      {isVideo ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 m-auto flex items-center justify-center rounded-full border border-white/30 bg-black/45 text-white shadow-lg backdrop-blur-md transition-transform duration-300 group-hover:scale-110',
            featured ? 'size-16' : 'size-12',
          )}
        >
          <Play className={cn('translate-x-px fill-current', featured ? 'size-6' : 'size-5')} />
        </span>
      ) : null}

      <figcaption className="absolute inset-x-0 bottom-0 p-3.5 sm:p-4">
        <span className="sr-only">{t('landing.showcase.promptLabel')}: </span>
        <p
          className={cn(
            'line-clamp-3 text-white [text-shadow:0_1px_8px_rgb(0_0_0/0.45)]',
            featured
              ? 'text-base font-medium sm:text-lg'
              : 'text-[0.8125rem] leading-snug sm:text-sm',
          )}
        >
          {t(item.prompt)}
        </p>
      </figcaption>
    </figure>
  );
}

export function Showcase({ i18n }: { i18n: Translator }) {
  const { t } = i18n;
  return (
    <Section id="showcase" className="-mt-4 sm:-mt-8">
      <SectionHeader
        id="showcase"
        eyebrow={t('landing.showcase.eyebrow')}
        title={t('landing.showcase.title')}
        description={t('landing.showcase.subtitle')}
      />
      <div
        className={cn(
          'mt-12 grid grid-flow-dense auto-rows-[9.25rem] grid-cols-2 gap-3 sm:auto-rows-[12rem] sm:gap-4 lg:auto-rows-[13.5rem] lg:grid-cols-4',
          styles.reveal,
        )}
      >
        {SHOWCASE_ITEMS.map((item) => (
          <SampleCard key={item.id} item={item} i18n={i18n} />
        ))}
      </div>
      <p className="mt-6 text-center text-sm text-subtle">{t('landing.showcase.note')}</p>
    </Section>
  );
}

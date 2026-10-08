import {
  ArrowRight,
  Clapperboard,
  CodeXml,
  Image as ImageIcon,
  ImagePlay,
  ImagePlus,
  Languages,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Directional } from '@/components/ui/icon';
import type { MessageKey, Translator } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Section, SectionHeader } from './section';
import styles from './marketing.module.css';

interface ToolFeature {
  icon: LucideIcon;
  title: MessageKey;
  description: MessageKey;
}

const TOOL_FEATURES: readonly ToolFeature[] = [
  {
    icon: ImageIcon,
    title: 'common.tools.textToImage.name',
    description: 'landing.features.textToImage',
  },
  {
    icon: ImagePlus,
    title: 'common.tools.imageToImage.name',
    description: 'landing.features.imageToImage',
  },
  {
    icon: Clapperboard,
    title: 'common.tools.textToVideo.name',
    description: 'landing.features.textToVideo',
  },
  {
    icon: ImagePlay,
    title: 'common.tools.imageToVideo.name',
    description: 'landing.features.imageToVideo',
  },
];

const API_ENDPOINTS = [
  ['POST', '/api/v1/generations'],
  ['GET', '/api/v1/generations/:id'],
  ['POST', '/api/v1/prompt/enhance'],
  ['GET', '/api/v1/models'],
] as const;

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand ring-1 ring-brand/25 transition-colors duration-200 group-hover:bg-primary group-hover:text-primary-foreground group-hover:ring-transparent"
    >
      <Icon className="size-5" />
    </span>
  );
}

function FeatureCard({
  className,
  featured = false,
  children,
}: {
  className?: string;
  /** The flagship card gets the brand gradient as its outline. */
  featured?: boolean;
  children: ReactNode;
}) {
  return (
    <article
      className={cn(
        'group relative flex flex-col gap-4 overflow-hidden rounded-2xl p-6 shadow-xs transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md',
        featured
          ? 'border-gradient-brand'
          : 'border border-border bg-surface hover:border-border-strong',
        className,
      )}
    >
      {children}
    </article>
  );
}

export function Features({ i18n }: { i18n: Translator }) {
  const { t } = i18n;
  return (
    <Section id="features">
      <SectionHeader
        id="features"
        eyebrow={t('landing.features.eyebrow')}
        title={t('landing.features.title')}
        description={t('landing.features.subtitle')}
      />
      <div className={cn('mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4', styles.reveal)}>
        {TOOL_FEATURES.map((feature) => (
          <FeatureCard key={feature.title}>
            <IconTile icon={feature.icon} />
            <div className="grid gap-2">
              <h3 className="text-lg font-semibold text-foreground rtl:font-bold">
                {t(feature.title)}
              </h3>
              <p className="text-sm leading-relaxed text-muted">{t(feature.description)}</p>
            </div>
          </FeatureCard>
        ))}

        <FeatureCard featured className="sm:col-span-2">
          <IconTile icon={WandSparkles} />
          <div className="grid gap-2">
            <h3 className="text-lg font-semibold text-foreground rtl:font-bold">
              {t('landing.features.enhancer.title')}
            </h3>
            <p className="text-sm leading-relaxed text-muted">
              {t('landing.features.enhancer.description')}
            </p>
          </div>
          <div className="mt-auto grid gap-2.5 rounded-xl border border-border bg-background/60 p-3.5">
            <div className="grid gap-1">
              <p className="text-xs font-medium text-subtle">
                {t('landing.features.enhancer.beforeLabel')}
              </p>
              <p className="text-sm text-foreground">{t('landing.features.enhancer.before')}</p>
            </div>
            <div className="flex items-center gap-2 text-brand" aria-hidden="true">
              <Languages className="size-4" />
              <span className="h-px flex-1 bg-linear-to-r from-brand/50 to-transparent rtl:bg-linear-to-l" />
              <Directional>
                <ArrowRight className="size-4" />
              </Directional>
            </div>
            <div className="grid gap-1">
              <p className="text-xs font-medium text-subtle">
                {t('landing.features.enhancer.afterLabel')}
              </p>
              <p dir="ltr" lang="en" className="text-start text-sm text-foreground">
                {t('landing.features.enhancer.after')}
              </p>
            </div>
          </div>
        </FeatureCard>

        <FeatureCard className="sm:col-span-2">
          <IconTile icon={CodeXml} />
          <div className="grid gap-2">
            <h3 className="text-lg font-semibold text-foreground rtl:font-bold">
              {t('landing.features.api.title')}
            </h3>
            <p className="text-sm leading-relaxed text-muted">
              {t('landing.features.api.description')}
            </p>
          </div>
          <div
            dir="ltr"
            aria-hidden="true"
            className="mt-auto rounded-xl border border-border bg-background/60 p-3.5 font-mono text-[13px] leading-6 text-muted"
          >
            {API_ENDPOINTS.map(([method, path]) => (
              <div key={`${method} ${path}`}>
                <span className={method === 'POST' ? 'text-brand' : 'text-accent'}>{method}</span>{' '}
                {path}
              </div>
            ))}
          </div>
        </FeatureCard>
      </div>
    </Section>
  );
}

import { ArrowLeft, Sparkles, WandSparkles } from 'lucide-react';
import { JsonLd } from '@/components/marketing/json-ld';
import { clipText, isolateLtr, needsDemoBadge } from '@/lib/generations/format';
import type { Translator } from '@/lib/i18n';
import { formatSeconds } from '@/lib/utils';
import { loginUrl } from '@/lib/next-path';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Directional } from '../ui/icon';
import { CopyButton } from './copy-button';
import { DetailRow, PromptBlock } from './detail-info';
import { remixHref, sharePath } from './links';
import { LocalTime } from './local-time';
import { modelInfo } from './model-info';
import { TOOL_NAME } from './tool-name';
import type { PublicCreation } from './public-creation';
import { shareJsonLd } from './share-meta';
import { ShareMedia } from './share-media';

/** The prompt is the heading up to this length; a longer one is cut there and shown whole below. */
const HEADING_CHARS = 200;

export interface ShareViewProps {
  creation: PublicCreation;
  /** The deployment's origin (`APP_URL`), for the copied link and the structured data. */
  origin: string;
  signedIn: boolean;
  i18n: Pick<Translator, 't' | 'locale'>;
}

/**
 * The public page of one shared creation, rendered on the server: the result large, the prompt as
 * the heading, who made it (first name only), how it was made and two ways forward: remix the
 * prompt in the studio, or start from scratch. A visitor who is not logged in goes to the log in
 * page first and arrives in the studio afterwards.
 */
export function ShareView({ creation, origin, signedIn, i18n }: ShareViewProps) {
  const { t, locale } = i18n;
  const model = modelInfo(creation.modelId, locale);
  const remix = remixHref(creation);
  const heading = clipText(creation.prompt, HEADING_CHARS);
  const shareLink = new URL(sharePath(creation.id), origin).href;
  const jsonLd = shareJsonLd(creation, origin, i18n);
  const { params } = creation;

  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
      <Button
        href="/explore"
        variant="ghost"
        size="sm"
        className="-ms-2 mb-4"
        startIcon={
          <Directional>
            <ArrowLeft className="size-4" />
          </Directional>
        }
      >
        {t('gallery.public.back')}
      </Button>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
        <div className="min-w-0 lg:sticky lg:top-24">
          <ShareMedia creation={creation} />
        </div>

        <article className="grid min-w-0 grid-cols-1 gap-6">
          <header className="grid grid-cols-1 gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="brand">
                {t(
                  creation.kind === 'video'
                    ? 'gallery.public.videoHeading'
                    : 'gallery.public.imageHeading',
                )}
              </Badge>
              <Badge>{model.label}</Badge>
              {needsDemoBadge(model.label, model.demo) ? (
                <Badge variant="outline">{t('studio.generations.card.demo')}</Badge>
              ) : null}
            </div>
            <h1
              dir="auto"
              className="text-2xl leading-snug font-semibold break-words text-foreground"
            >
              {heading}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
              {creation.ownerFirstName ? (
                <>
                  <span>
                    {t('gallery.explore.card.by')}{' '}
                    <bdi className="font-medium text-foreground">{creation.ownerFirstName}</bdi>
                  </span>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <LocalTime timestamp={creation.createdAt} />
            </p>
          </header>

          <div className="flex flex-wrap gap-2">
            <CopyButton
              text={creation.prompt}
              label={t('gallery.detail.copyPrompt')}
              failedMessage={t('gallery.detail.copyFailed')}
            />
            <CopyButton
              text={shareLink}
              label={t('gallery.public.copyLink')}
              failedMessage={t('studio.generations.toast.linkCopyFailed')}
              variant="outline"
            />
          </div>

          {heading !== creation.prompt ? (
            <PromptBlock title={t('gallery.detail.prompt')} text={creation.prompt} />
          ) : null}
          {creation.negativePrompt ? (
            <PromptBlock
              title={t('gallery.detail.negativePrompt')}
              text={creation.negativePrompt}
            />
          ) : null}

          <section className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-surface p-5 shadow-xs">
            <Button
              href={signedIn ? remix : loginUrl(remix)}
              size="lg"
              startIcon={<WandSparkles />}
            >
              {t('gallery.public.remix')}
            </Button>
            <p className="text-sm text-muted">
              {t('gallery.public.remixHint')} {signedIn ? null : t('gallery.public.remixLogin')}
            </p>
            <Button
              href={signedIn ? '/studio' : '/register?next=%2Fstudio'}
              variant="secondary"
              startIcon={<Sparkles />}
            >
              {t('gallery.public.create')}
            </Button>
          </section>

          <section aria-labelledby="share-about">
            <h2 id="share-about" className="text-sm font-semibold text-foreground">
              {t('gallery.public.about')}
            </h2>
            <dl className="mt-1 divide-y divide-border">
              <DetailRow label={t('gallery.detail.model')}>{model.label}</DetailRow>
              <DetailRow label={t('gallery.detail.tool')}>{t(TOOL_NAME[creation.tool])}</DetailRow>
              <DetailRow label={t('gallery.detail.aspectRatio')}>
                {isolateLtr(params.aspectRatio)}
              </DetailRow>
              {params.durationSec !== undefined ? (
                <DetailRow label={t('gallery.detail.duration')}>
                  {formatSeconds(params.durationSec, locale)}
                </DetailRow>
              ) : null}
              {params.resolution ? (
                <DetailRow label={t('gallery.detail.resolution')}>
                  {isolateLtr(params.resolution)}
                </DetailRow>
              ) : null}
            </dl>
          </section>
        </article>
      </div>
    </main>
  );
}

'use client';

import { useId, type ReactNode } from 'react';
import type { GenerationDTO } from '@/lib/api-types';
import { StatusBadge } from '@/components/generations';
import { creditsText, isolateLtr, needsDemoBadge } from '@/lib/generations/format';
import { useI18n } from '@/lib/i18n/client';
import { formatBytes, formatNumber, formatSeconds } from '@/lib/utils';
import { Badge } from '../ui/badge';
import { CopyButton } from './copy-button';
import { LocalTime } from './local-time';
import { modelInfo } from './model-info';
import { TOOL_NAME } from './tool-name';

/** One line of a details list: what it is, and its value. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-baseline gap-x-3 py-2.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm font-medium break-words text-foreground">{children}</dd>
    </div>
  );
}

export interface PromptBlockProps {
  title: string;
  text: string;
  /** Adds a copy button with this text. */
  copyLabel?: string;
  /** What a refused copy says; required with `copyLabel`. */
  copyFailed?: string;
}

/**
 * A prompt as written, in its own direction, with the button that copies it. A long prompt scrolls
 * inside its box, so the box takes the keyboard focus (and is announced as a region named after the
 * block): without that, a keyboard user could not reach the rest of the text.
 */
export function PromptBlock({ title, text, copyLabel, copyFailed }: PromptBlockProps) {
  const headingId = useId();
  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        {copyLabel ? (
          <CopyButton
            text={text}
            label={copyLabel}
            size="sm"
            variant="ghost"
            failedMessage={copyFailed ?? ''}
          />
        ) : null}
      </div>
      <div
        role="region"
        aria-labelledby={headingId}
        tabIndex={0}
        dir="auto"
        className="max-h-72 overflow-y-auto rounded-xl border border-border bg-surface-raised p-3 text-sm leading-7 break-words whitespace-pre-wrap text-foreground"
      >
        {text}
      </div>
    </div>
  );
}

/** The prompt (and the negative prompt, when there is one) of a creation, each with a copy button. */
export function DetailPrompts({ generation }: { generation: GenerationDTO }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-5">
      <PromptBlock
        title={t('gallery.detail.prompt')}
        text={generation.prompt}
        copyLabel={t('gallery.detail.copyPrompt')}
        copyFailed={t('gallery.detail.copyFailed')}
      />
      {generation.negativePrompt ? (
        <PromptBlock title={t('gallery.detail.negativePrompt')} text={generation.negativePrompt} />
      ) : null}
    </div>
  );
}

export interface DetailSettingsProps {
  generation: GenerationDTO;
  /** The result on show: its size and file size are listed. */
  outputIndex: number;
}

/** What a creation was made with and how it went, as a list. */
export function DetailSettings({ generation, outputIndex }: DetailSettingsProps) {
  const { t, plural, locale } = useI18n();
  const model = modelInfo(generation.modelId, locale);
  const { params } = generation;
  const output = generation.outputs[outputIndex];
  const seconds =
    generation.startedAt !== undefined && generation.finishedAt !== undefined
      ? Math.max(0, Math.round((generation.finishedAt - generation.startedAt) / 1000))
      : undefined;

  return (
    <div className="grid grid-cols-1 gap-5">
      <section aria-labelledby="detail-settings">
        <h2 id="detail-settings" className="text-sm font-semibold text-foreground">
          {t('gallery.detail.settings')}
        </h2>
        <dl className="mt-1 divide-y divide-border">
          <DetailRow label={t('gallery.detail.status')}>
            <StatusBadge status={generation.status} />
          </DetailRow>
          <DetailRow label={t('gallery.detail.model')}>
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              {model.label}
              {needsDemoBadge(model.label, model.demo) ? (
                <Badge size="sm">{t('studio.generations.card.demo')}</Badge>
              ) : null}
            </span>
            {model.description ? (
              <span className="mt-0.5 block text-xs font-normal text-muted">
                {model.description}
              </span>
            ) : null}
          </DetailRow>
          <DetailRow label={t('gallery.detail.tool')}>{t(TOOL_NAME[generation.tool])}</DetailRow>
          <DetailRow label={t('gallery.detail.aspectRatio')}>
            {isolateLtr(params.aspectRatio)}
          </DetailRow>
          {generation.kind === 'image' && params.count > 1 ? (
            <DetailRow label={t('gallery.detail.count')}>
              {formatNumber(params.count, locale)}
            </DetailRow>
          ) : null}
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
          {params.seed !== undefined ? (
            <DetailRow label={t('gallery.detail.seed')}>
              {formatNumber(params.seed, locale, { useGrouping: false })}
            </DetailRow>
          ) : null}
          {params.strength !== undefined ? (
            <DetailRow label={t('gallery.detail.strength')}>
              {formatNumber(params.strength, locale, { style: 'percent' })}
            </DetailRow>
          ) : null}
          {output?.width && output.height ? (
            <DetailRow label={t('gallery.detail.size')}>
              {t('gallery.detail.dimensions', {
                width: formatNumber(output.width, locale, { useGrouping: false }),
                height: formatNumber(output.height, locale, { useGrouping: false }),
              })}
              <span className="ms-2 text-xs font-normal text-muted">
                {formatBytes(output.bytes, locale)}
              </span>
            </DetailRow>
          ) : null}
          <DetailRow label={t('gallery.detail.cost')}>
            {creditsText({ t, plural }, generation.cost)}
          </DetailRow>
          <DetailRow label={t('gallery.detail.created')}>
            <LocalTime timestamp={generation.createdAt} />
          </DetailRow>
          {generation.finishedAt !== undefined ? (
            <DetailRow label={t('gallery.detail.finished')}>
              <LocalTime timestamp={generation.finishedAt} />
              {seconds === undefined ? null : (
                <span className="ms-2 text-xs font-normal text-muted">
                  {t('gallery.detail.took', { time: formatSeconds(seconds, locale) })}
                </span>
              )}
            </DetailRow>
          ) : null}
        </dl>
      </section>
    </div>
  );
}

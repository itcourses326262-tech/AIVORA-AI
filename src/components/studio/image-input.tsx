'use client';

import { CircleAlert, ImagePlus, Replace, Upload, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { errorMessage } from '@/components/ui/error-message';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/lib/generations/upload';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatBytes, formatNumber } from '@/lib/utils';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { Progress } from '../ui/progress';
import type { ImageInput, ImageInputError } from './use-image-input';

export interface ImageInputFieldProps {
  input: ImageInput;
  /** `dropzone`: the large target of the side panel; `compact`: the attachment chip of a phone. */
  variant: 'dropzone' | 'compact';
  /** The problem to show: a failed upload, or the form's "add an image". */
  error?: string | null;
}

const ACCEPT = ALLOWED_IMAGE_TYPES.join(',');

function Thumb({ src, className }: { src: string; className: string }) {
  const { t } = useI18n();
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL or our own media route
    <img src={src} alt={t('studio.image.preview')} className={className} />
  );
}

/** The first picture among the files, else the first file: a wrong type is reported, not ignored. */
function chosenFile(files: FileList | readonly File[] | null | undefined): File | undefined {
  const all = Array.from(files ?? []);
  return all.find((file) => file.type.startsWith('image/')) ?? all[0];
}

/** Only a picture counts for a paste: pasted text belongs to the prompt. */
function pastedPicture(files: FileList | readonly File[] | null | undefined): File | undefined {
  return Array.from(files ?? []).find((file) => file.type.startsWith('image/'));
}

/** Text for what went wrong with the picture, in the user's language. */
function useProblemText(error: ImageInputError | undefined): string | null {
  const { t, locale } = useI18n();
  if (!error) return null;
  switch (error.kind) {
    case 'type':
      return t('studio.image.errors.type');
    case 'size':
      return t('studio.image.errors.size', { size: formatBytes(MAX_UPLOAD_BYTES, locale) });
    case 'import':
      return t('studio.image.errors.import');
    case 'api':
      return errorMessage(t, error.error);
  }
}

/**
 * The input image of the image tools: click, drop or paste a PNG, JPEG or WebP (checked here before
 * anything is sent), watch it upload, replace it or take it away. One instance listens for pastes.
 */
export function ImageInputField({ input, variant, error }: ImageInputFieldProps) {
  const { t, locale } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const describedBy = useId();
  const { state } = input;
  const problem = useProblemText(state.status === 'empty' ? state.error : undefined);
  const message = problem ?? error ?? null;

  const choose = useCallback(() => fileInput.current?.click(), []);

  const { accept } = input;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = pastedPicture(event.clipboardData?.files);
      if (!file) return;
      // Pasted text still goes to the prompt; only a picture is taken for the input.
      event.preventDefault();
      accept(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [accept]);

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = chosenFile(event.target.files);
    if (file) input.accept(file);
    // The same file can be chosen again after removing it.
    event.target.value = '';
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = chosenFile(event.dataTransfer.files);
    if (file) input.accept(file);
  };
  const dragHandlers = {
    onDragEnter: (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => event.preventDefault(),
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop,
  };

  const hidden = (
    <input
      ref={fileInput}
      type="file"
      accept={ACCEPT}
      tabIndex={-1}
      aria-hidden="true"
      className="hidden"
      onChange={onPick}
    />
  );

  const busy = state.status === 'uploading' || state.status === 'importing';
  const preview =
    state.status === 'uploading'
      ? state.previewUrl
      : state.status === 'importing'
        ? state.previewUrl
        : state.status === 'ready'
          ? state.previewUrl
          : null;
  const percent = state.status === 'uploading' ? Math.round(state.progress * 100) : undefined;
  const status =
    state.status === 'uploading'
      ? t('studio.image.uploading', {
          percent: formatNumber(state.progress, locale, { style: 'percent' }),
        })
      : state.status === 'importing'
        ? t('studio.image.importing')
        : null;

  if (variant === 'compact') {
    return (
      <div className="grid grid-cols-1 gap-1.5" {...dragHandlers}>
        {hidden}
        {state.status === 'empty' ? (
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start border-dashed"
            startIcon={<ImagePlus aria-hidden="true" />}
            onClick={choose}
            aria-describedby={message ? describedBy : undefined}
          >
            {t('studio.image.attach')}
          </Button>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-raised p-1.5 pe-2">
            {preview ? (
              <Thumb src={preview} className="size-10 shrink-0 rounded-lg object-cover" />
            ) : (
              <span aria-hidden="true" className="size-10 shrink-0 rounded-lg bg-shimmer" />
            )}
            <div className="min-w-0 flex-1">
              {busy ? (
                <>
                  <p className="truncate text-xs text-muted">{status}</p>
                  <Progress
                    size="sm"
                    value={percent}
                    label={status ?? undefined}
                    className="mt-1"
                  />
                </>
              ) : (
                <p className="truncate text-sm text-foreground">
                  {state.status === 'ready' ? (state.name ?? t('studio.image.preview')) : ''}
                </p>
              )}
            </div>
            <IconButton
              label={busy ? t('studio.image.cancelUpload') : t('studio.image.remove')}
              size="sm"
              onClick={input.clear}
            >
              <X />
            </IconButton>
          </div>
        )}
        {message ? (
          <p id={describedBy} role="alert" className="flex items-start gap-1.5 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{message}</span>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {hidden}
      <div
        {...dragHandlers}
        className={cn(
          'relative overflow-hidden rounded-xl border-2 border-dashed transition-colors duration-150',
          dragging
            ? 'border-primary bg-brand-soft'
            : message
              ? 'border-danger/60 bg-danger-soft/40'
              : 'border-field bg-surface hover:border-muted',
          state.status !== 'empty' && 'border-solid border-border',
        )}
      >
        {state.status === 'empty' ? (
          <button
            type="button"
            onClick={choose}
            aria-label={t('studio.image.region')}
            aria-describedby={`${describedBy}-hint`}
            className="flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-[inherit] px-4 py-6 text-center outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span
              aria-hidden="true"
              className="mb-1 flex size-11 items-center justify-center rounded-xl border border-border bg-surface-raised text-brand"
            >
              <Upload className="size-5" />
            </span>
            <span className="text-sm font-medium text-foreground">
              {dragging ? t('studio.image.drop.active') : t('studio.image.drop.title')}
            </span>
            <span id={`${describedBy}-hint`} className="text-xs text-muted">
              {t('studio.image.drop.hint', { size: formatBytes(MAX_UPLOAD_BYTES, locale) })}
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-3 p-2.5">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-surface-raised">
              {preview ? (
                <Thumb src={preview} className="size-full object-cover" />
              ) : (
                <span aria-hidden="true" className="absolute inset-0 animate-shimmer bg-shimmer" />
              )}
            </div>
            <div className="grid min-w-0 flex-1 gap-2">
              {busy ? (
                <>
                  <p role="status" className="truncate text-sm text-foreground">
                    {status}
                  </p>
                  <Progress size="sm" value={percent} label={status ?? undefined} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-self-start"
                    onClick={input.clear}
                  >
                    {t('studio.image.cancelUpload')}
                  </Button>
                </>
              ) : (
                <>
                  <div className="grid gap-0.5">
                    <p className="truncate text-sm font-medium text-foreground">
                      {state.status === 'ready' ? (state.name ?? t('studio.image.preview')) : ''}
                    </p>
                    {state.status === 'ready' && state.width && state.height ? (
                      <p className="text-xs text-muted tabular-nums">
                        {t('studio.image.dimensions', { width: state.width, height: state.height })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      startIcon={<Replace aria-hidden="true" />}
                      onClick={choose}
                    >
                      {t('studio.image.replace')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={input.clear}>
                      {t('studio.image.remove')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {message ? (
        <p id={describedBy} role="alert" className="flex items-start gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}

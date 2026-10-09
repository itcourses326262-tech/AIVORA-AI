'use client';

import { Copy, ExternalLink } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

/** Copies `text` to the clipboard; false when the browser (an in-app one, often) refuses. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No clipboard API, or no permission: try the old way before giving up.
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

export interface InAppBrowserNoteProps {
  /** `note` is advice shown up front; `error` is the answer to a sign-in that failed. */
  tone: 'note' | 'error';
  children: ReactNode;
}

/**
 * Tells the visitor that Google sign-in needs their own browser, and lets them copy the link of this
 * page to paste there: the in-app browsers of social apps are where Google refuses to sign anyone
 * in. When the copy is refused, the link is shown to be selected by hand.
 */
export function InAppBrowserNote({ tone, children }: InAppBrowserNoteProps) {
  const { t } = useI18n();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [link, setLink] = useState('');

  async function copyLink() {
    const href = window.location.href;
    setLink(href);
    setCopy((await copyText(href)) ? 'copied' : 'failed');
  }

  return (
    <div
      className={cn(
        'grid gap-3 rounded-xl border px-3.5 py-3 text-sm',
        tone === 'error'
          ? 'border-danger/30 bg-danger-soft text-danger'
          : 'border-warning/40 bg-warning-soft text-foreground',
      )}
    >
      <p className="flex items-start gap-2.5">
        <ExternalLink aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 flex-1">{children}</span>
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        startIcon={<Copy aria-hidden="true" className="size-4" />}
        onClick={() => void copyLink()}
      >
        {t('auth.google.inApp.copy')}
      </Button>
      <p role="status" className="min-w-0 empty:hidden">
        {copy === 'copied' ? t('auth.google.inApp.copied') : null}
        {copy === 'failed' ? t('auth.google.inApp.copyFailed') : null}
      </p>
      {copy === 'failed' ? (
        <input
          readOnly
          dir="ltr"
          value={link}
          aria-label={t('auth.google.inApp.linkLabel')}
          onFocus={(event) => event.currentTarget.select()}
          className="h-10 w-full min-w-0 rounded-lg border border-field bg-surface px-3 text-start text-foreground"
        />
      ) : null}
    </div>
  );
}

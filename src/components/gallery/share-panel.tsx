'use client';

import { ExternalLink, Eye, Lock } from 'lucide-react';
import { useId, useSyncExternalStore } from 'react';
import type { GenerationDTO } from '@/lib/api-types';
import { useI18n } from '@/lib/i18n/client';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { CopyButton } from './copy-button';
import { sharePath } from './links';

const subscribe = () => () => {};

export interface SharePanelProps {
  generation: GenerationDTO;
  onToggle: (generation: GenerationDTO) => void;
}

/**
 * Sharing of one finished creation: the switch, a plain statement of what becomes public and what
 * never does, and, while it is shared, the link with a copy button.
 */
export function SharePanel({ generation, onToggle }: SharePanelProps) {
  const { t } = useI18n();
  const origin = useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => '',
  );
  const noteId = useId();
  const link = `${origin}${sharePath(generation.id)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('gallery.share.title')}</CardTitle>
        <CardDescription>{t('gallery.share.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        <Switch
          label={t('gallery.share.toggle')}
          checked={generation.isPublic}
          aria-describedby={noteId}
          onCheckedChange={() => onToggle(generation)}
        />
        <ul id={noteId} className="grid grid-cols-1 gap-2 text-sm">
          <li className="flex items-start gap-2.5">
            <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>
              <span className="font-medium text-foreground">{t('gallery.share.publicLabel')}</span>{' '}
              <span className="text-muted">{t('gallery.share.publicList')}</span>
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              <span className="font-medium text-foreground">{t('gallery.share.privateLabel')}</span>{' '}
              <span className="text-muted">{t('gallery.share.privateList')}</span>
            </span>
          </li>
        </ul>
        {generation.isPublic ? (
          <div className="grid grid-cols-1 gap-2 border-t border-border pt-4">
            <label htmlFor={`${noteId}-link`} className="text-sm font-medium text-foreground">
              {t('gallery.share.link')}
            </label>
            <Input
              id={`${noteId}-link`}
              readOnly
              dir="ltr"
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className="text-start"
            />
            <div className="flex flex-wrap gap-2">
              <CopyButton
                text={link}
                label={t('gallery.share.copy')}
                copiedLabel={t('gallery.share.copied')}
                failedMessage={t('studio.generations.toast.linkCopyFailed')}
              />
              <Button
                href={sharePath(generation.id)}
                variant="outline"
                target="_blank"
                startIcon={<ExternalLink />}
              >
                {t('gallery.share.open')}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

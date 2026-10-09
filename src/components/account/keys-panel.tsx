'use client';

import { ArrowRight, BookOpen, KeyRound, Plus, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CodeWindow } from '@/components/docs/code-window';
import { highlight } from '@/components/docs/tokenize';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Directional } from '@/components/ui/icon';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApiKeyDTO, CreateApiKeyResponse } from '@/lib/api-types';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import { CreateKeyDialog, RevealKeyDialog, RevokeKeyDialog, type KeyLimits } from './key-dialogs';
import { useApiKeys } from './use-api-keys';

function KeyRow({ apiKey, onRevoke }: { apiKey: ApiKeyDTO; onRevoke: (key: ApiKeyDTO) => void }) {
  const { t, locale } = useI18n();
  const revoked = apiKey.revokedAt !== undefined;
  return (
    <li
      // A row can take focus from code: the revoke button of a key is gone once it is revoked.
      tabIndex={-1}
      data-key-id={apiKey.id}
      className={cn(
        'grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 focus-visible:-outline-offset-2 sm:grid-cols-[1fr_auto] sm:items-center',
        revoked && 'opacity-75',
      )}
    >
      <div className="grid min-w-0 grid-cols-1 gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold break-words text-foreground">{apiKey.name}</span>
          {revoked ? (
            <Badge variant="neutral" dot>
              {t('account.keys.revokedStatus')}
            </Badge>
          ) : (
            <Badge variant="success" dot>
              {t('account.keys.active')}
            </Badge>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <span className="sr-only">{t('account.keys.keyPrefix')}</span>
          <code
            dir="ltr"
            className="rounded-md bg-foreground/[0.08] px-1.5 py-0.5 font-mono text-xs text-foreground"
          >
            {apiKey.prefix}…
          </code>
        </p>
        <p className="text-xs text-muted">
          {t('account.keys.createdOn', { date: formatDate(apiKey.createdAt, locale) })}
          {' · '}
          {revoked
            ? t('account.keys.revokedOn', { date: formatDate(apiKey.revokedAt ?? 0, locale) })
            : apiKey.lastUsedAt === undefined
              ? t('account.keys.neverUsed')
              : t('account.keys.lastUsed', { time: formatRelativeTime(apiKey.lastUsedAt, locale) })}
        </p>
      </div>
      {revoked ? null : (
        <Button
          variant="outline"
          size="sm"
          className="border-danger/40 text-danger"
          aria-label={t('account.keys.revokeLabel', { name: apiKey.name })}
          onClick={() => onRevoke(apiKey)}
        >
          {t('account.keys.revoke')}
        </Button>
      )}
    </li>
  );
}

function KeysSkeleton() {
  const { t } = useI18n();
  return (
    <div aria-busy="true" className="grid grid-cols-1 gap-3">
      <span className="sr-only">{t('common.a11y.loading')}</span>
      {[0, 1].map((row) => (
        <Skeleton key={row} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}

export interface KeysPanelProps {
  limits: KeyLimits;
  /** `https://host` of this deployment, for the examples. */
  origin: string;
}

/**
 * The account's API keys: list, create (the secret appears once, in a dialog that cannot be closed
 * by accident), revoke after confirming, and a short way to try a key.
 */
export function KeysPanel({ limits, origin }: KeysPanelProps) {
  const { t } = useI18n();
  const keys = useApiKeys();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateApiKeyResponse | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyDTO | null>(null);
  const rowsRef = useRef<HTMLUListElement>(null);
  // The key just revoked: the button the reader pressed disappears with it, so the dialog has
  // nowhere to return focus to and it would fall to the top of the page. The key's own row, which
  // now says "Revoked", takes it instead.
  const revokedKey = useRef<string | null>(null);
  useEffect(() => {
    const id = revokedKey.current;
    if (id === null) return;
    revokedKey.current = null;
    const rows = rowsRef.current?.querySelectorAll<HTMLElement>('li[data-key-id]') ?? [];
    [...rows].find((row) => row.dataset.keyId === id)?.focus();
  }, [keys.keys]);

  const active = keys.keys.filter((key) => key.revokedAt === undefined).length;
  const atLimit = active >= limits.maxActive;
  const snippet = `curl "${origin}/api/v1/account" \\\n  -H "Authorization: Bearer $AIVORE_API_KEY"`;

  let list;
  if (keys.status === 'loading') list = <KeysSkeleton />;
  else if (keys.status === 'error') {
    list = (
      <ErrorState
        error={keys.error}
        title={t('account.keys.loadFailed')}
        onRetry={keys.reload}
        headingLevel={3}
      />
    );
  } else if (keys.keys.length === 0) {
    list = (
      <EmptyState
        icon={<KeyRound />}
        title={t('account.keys.empty.title')}
        description={t('account.keys.empty.body')}
        headingLevel={3}
      />
    );
  } else {
    list = (
      <ul ref={rowsRef} aria-label={t('account.keys.listLabel')} className="grid grid-cols-1 gap-3">
        {keys.keys.map((key) => (
          <KeyRow key={key.id} apiKey={key} onRevoke={setRevoking} />
        ))}
      </ul>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid max-w-2xl grid-cols-1 gap-1.5">
              <CardTitle as="h2">{t('account.keys.title')}</CardTitle>
              <CardDescription>{t('account.keys.description')}</CardDescription>
            </div>
            <Button
              disabled={atLimit || keys.status !== 'ready'}
              startIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setCreating(true)}
            >
              {t('account.keys.create')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          {atLimit ? (
            <p
              role="status"
              className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-3 text-sm text-foreground"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
              {t('account.keys.limitReached', { max: limits.maxActive })}
            </p>
          ) : null}
          {list}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('account.keys.quick.title')}</CardTitle>
          <CardDescription>{t('account.keys.quick.body')}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <CodeWindow
            lines={highlight(snippet, 'bash')}
            text={snippet}
            title="cURL"
            scope={t('account.keys.quick.title')}
            labels={{
              copy: t('common.actions.copy'),
              copied: t('common.actions.copied'),
              copyFailed: t('account.keys.reveal.copyFailed'),
            }}
          />
          <div>
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 text-sm font-medium text-brand underline-offset-4 hover:underline"
            >
              <BookOpen aria-hidden="true" className="size-4" />
              {t('account.keys.quick.docs')}
              <Directional>
                <ArrowRight aria-hidden="true" className="size-4" />
              </Directional>
            </Link>
          </div>
        </CardContent>
      </Card>

      <CreateKeyDialog
        open={creating}
        onOpenChange={setCreating}
        limits={limits}
        onCreated={(response) => {
          keys.add(response.record);
          setCreated(response);
          setCreating(false);
        }}
      />
      <RevealKeyDialog created={created} origin={origin} onDone={() => setCreated(null)} />
      <RevokeKeyDialog
        target={revoking}
        onClose={() => setRevoking(null)}
        onRevoked={(id) => {
          revokedKey.current = id;
          keys.markRevoked(id);
        }}
      />
    </div>
  );
}

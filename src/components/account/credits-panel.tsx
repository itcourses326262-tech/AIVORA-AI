'use client';

import { ArrowDownRight, ArrowUpRight, Coins, CreditCard, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Directional } from '@/components/ui/icon';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { LedgerEntryDTO } from '@/lib/api-types';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';
import { cn, formatCredits, formatDateTime, formatNumber } from '@/lib/utils';
import { generationHref, loadedMoreLabel, REASON_KEYS, visibleNote } from './ledger';
import { useLedger } from './use-ledger';

const LOW_BALANCE = 5;

function BalanceCard() {
  const i18n = useI18n();
  const { t } = i18n;
  const { creditBalance, refresh } = useUser();
  // The number in the header may be a minute old; this page is where it should be exact.
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const low = creditBalance <= LOW_BALANCE;
  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="grid grid-cols-1 gap-1">
          <p className="text-sm font-medium text-muted">{t('account.credits.balanceTitle')}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-4xl font-bold tracking-tight text-foreground tabular-nums">
              {creditsLabel(i18n, creditBalance)}
            </span>
            {low ? (
              <Badge variant={creditBalance <= 0 ? 'danger' : 'warning'} dot>
                {t('account.credits.low')}
              </Badge>
            ) : null}
          </p>
          <p className="text-sm text-muted">{t('account.credits.balanceNote')}</p>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:justify-items-end">
          <Button
            href="/account/billing"
            startIcon={<CreditCard aria-hidden="true" className="size-4" />}
            endIcon={
              <Directional>
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </Directional>
            }
          >
            {t('account.credits.billingLink')}
          </Button>
          <p className="text-xs text-muted">{t('account.credits.billingBody')}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Delta({ entry }: { entry: LedgerEntryDTO }) {
  const { t, locale } = useI18n();
  const gained = entry.delta > 0;
  const Icon = gained ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-semibold tabular-nums',
        gained ? 'text-success' : 'text-foreground',
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      <span>{formatNumber(entry.delta, locale, { signDisplay: 'always' })}</span>
      <span className="sr-only">
        {gained ? t('account.credits.added') : t('account.credits.spent')}
      </span>
    </span>
  );
}

function Activity({ entry }: { entry: LedgerEntryDTO }) {
  const { t } = useI18n();
  const note = visibleNote(entry);
  return (
    <div className="grid grid-cols-1 gap-0.5">
      <span className="font-medium text-foreground">{t(REASON_KEYS[entry.reason])}</span>
      {note ? (
        // `bdi` orders the words of a note by their own script and leaves the line where the page puts it.
        <span className="text-xs text-muted">
          <bdi>{note}</bdi>
        </span>
      ) : null}
      {entry.generationId ? (
        <Link
          href={generationHref(entry.generationId)}
          className="w-fit text-xs text-brand underline-offset-4 hover:underline"
        >
          {t('account.credits.viewGeneration')}
        </Link>
      ) : null}
    </div>
  );
}

function LedgerSkeleton() {
  const { t } = useI18n();
  return (
    <div aria-busy="true" className="grid grid-cols-1 gap-3 p-5">
      <span className="sr-only">{t('common.a11y.loading')}</span>
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-10 w-full" />
      ))}
    </div>
  );
}

function History() {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const ledger = useLedger();
  const rows = useRef<HTMLTableSectionElement>(null);
  const end = useRef<HTMLParagraphElement>(null);
  // Where the entries asked for by the reader start; null when no page is awaited.
  const awaited = useRef<number | null>(null);

  function loadMore() {
    awaited.current = ledger.entries.length;
    ledger.loadMore();
  }

  // The button the reader pressed is replaced by "That is everything" on the last page. Focus would
  // fall to the top of the page, so it goes to the first new entry (or to the note when the last page
  // was empty). While the button stays it keeps focus, so pressing it again is one key away.
  const { busy, hasMore, entries } = ledger;
  useEffect(() => {
    const from = awaited.current;
    if (from === null || busy) return;
    if (entries.length > from || !hasMore) awaited.current = null;
    if (hasMore) return;
    (rows.current?.rows[from] ?? end.current)?.focus();
  }, [busy, hasMore, entries.length]);

  let body;
  if (ledger.status === 'loading') body = <LedgerSkeleton />;
  else if (ledger.status === 'error') {
    body = (
      <div className="p-5">
        <ErrorState
          error={ledger.error}
          title={t('account.credits.loadFailed')}
          onRetry={ledger.retry}
          headingLevel={3}
        />
      </div>
    );
  } else if (ledger.entries.length === 0) {
    body = (
      <div className="p-5">
        <EmptyState
          icon={<Coins />}
          title={t('account.credits.empty.title')}
          description={t('account.credits.empty.body')}
          headingLevel={3}
          action={
            <Button href="/studio" variant="secondary" startIcon={<Sparkles className="size-4" />}>
              {t('account.credits.empty.action')}
            </Button>
          }
        />
      </div>
    );
  } else {
    body = (
      <>
        <table className="w-full text-start text-sm max-sm:block">
          <caption className="sr-only">{t('account.credits.historyTitle')}</caption>
          <thead className="max-sm:hidden">
            <tr className="border-y border-border bg-surface-raised text-xs text-muted">
              <th scope="col" className="px-5 py-2 text-start font-medium">
                {t('account.credits.columns.date')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('account.credits.columns.activity')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('account.credits.columns.change')}
              </th>
              <th scope="col" className="px-5 py-2 text-end font-medium">
                {t('account.credits.columns.balance')}
              </th>
            </tr>
          </thead>
          <tbody ref={rows} className="max-sm:block">
            {ledger.entries.map((entry, index) => (
              <tr
                key={entry.id}
                tabIndex={-1}
                className={cn(
                  'align-top focus-visible:-outline-offset-2 max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-3 max-sm:gap-y-1 max-sm:px-5 max-sm:py-3',
                  index > 0 && 'border-t border-border',
                  index === 0 && 'max-sm:border-t max-sm:border-border',
                )}
              >
                <td className="px-5 py-3 text-xs whitespace-nowrap text-muted max-sm:order-3 max-sm:col-span-2 max-sm:p-0">
                  {formatDateTime(entry.createdAt, locale)}
                  <span className="sm:hidden">
                    {' · '}
                    {t('account.credits.columns.balance')}{' '}
                    {formatCredits(entry.balanceAfter, locale)}
                  </span>
                </td>
                <td className="px-3 py-3 max-sm:order-1 max-sm:p-0">
                  <Activity entry={entry} />
                </td>
                <td className="px-3 py-3 text-end max-sm:order-2 max-sm:p-0">
                  <Delta entry={entry} />
                </td>
                <td className="px-5 py-3 text-end text-muted tabular-nums max-sm:hidden">
                  {formatCredits(entry.balanceAfter, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-1 justify-items-center gap-2 border-t border-border p-4">
          {ledger.moreFailed ? (
            <p role="alert" className="text-sm text-danger">
              {t('account.credits.loadFailed')}
            </p>
          ) : null}
          {ledger.hasMore ? (
            <Button variant="secondary" loading={ledger.busy} onClick={loadMore}>
              {ledger.busy ? t('account.credits.loadingMore') : t('account.credits.loadMore')}
            </Button>
          ) : (
            <p ref={end} tabIndex={-1} className="text-sm text-muted">
              {t('account.credits.end')}
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle as="h2">{t('account.credits.historyTitle')}</CardTitle>
        <CardDescription>{t('account.credits.historyDescription')}</CardDescription>
      </CardHeader>
      {body}
      <p role="status" className="sr-only">
        {ledger.added > 0 ? loadedMoreLabel(i18n, ledger.added, ledger.entries.length) : ''}
      </p>
    </Card>
  );
}

export function CreditsPanel() {
  return (
    <div className="grid grid-cols-1 gap-5">
      <BalanceCard />
      <History />
    </div>
  );
}

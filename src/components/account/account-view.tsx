'use client';

import { CreditCard, Database, KeyRound, ShieldCheck, UserRound, Coins } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccountDataRights } from '@/components/auth/account-data-rights';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';
import { CreditsPanel } from './credits-panel';
import type { KeyLimits } from './key-dialogs';
import { KeysPanel } from './keys-panel';
import { ProfilePanel } from './profile-panel';
import { SecurityPanel } from './security-panel';
import { ACCOUNT_TABS, accountHref, isAccountTab, type AccountTab } from './tabs';

const TAB_ICONS: Record<AccountTab, ReactNode> = {
  profile: <UserRound aria-hidden="true" />,
  security: <ShieldCheck aria-hidden="true" />,
  credits: <Coins aria-hidden="true" />,
  keys: <KeyRound aria-hidden="true" />,
  data: <Database aria-hidden="true" />,
};

export interface AccountViewProps {
  /** The tab the address asked for (`?tab=`). */
  initialTab: AccountTab;
  limits: KeyLimits;
  /** `https://host` of this deployment, for the examples. */
  origin: string;
}

/**
 * The account page: who you are, a way to the billing page and five deep-linkable sections. A
 * section's content is created the first time it is opened and then kept, so a form or a loaded
 * list survives switching tabs. The address follows the tab (`?tab=`) without a new history entry.
 */
export function AccountView({ initialTab, limits, origin }: AccountViewProps) {
  const { t } = useI18n();
  const { user } = useUser();
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const [visited, setVisited] = useState<ReadonlySet<AccountTab>>(new Set([initialTab]));
  const [seed, setSeed] = useState(initialTab);
  const tabList = useRef<HTMLDivElement>(null);

  // Five tabs do not fit a phone: the row scrolls sideways, so bring the open one into view
  // (a deep link such as `?tab=data` would otherwise open a tab that is off the screen).
  useEffect(() => {
    tabList.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [tab]);

  // A link to another tab of this very page arrives as a new `initialTab`: follow it.
  if (seed !== initialTab) {
    setSeed(initialTab);
    setTab(initialTab);
    setVisited((current) => new Set(current).add(initialTab));
  }

  function select(next: string) {
    if (!isAccountTab(next)) return;
    setTab(next);
    setVisited((current) => (current.has(next) ? current : new Set(current).add(next)));
    window.history.replaceState(window.history.state, '', accountHref(next));
  }

  const panels: Record<AccountTab, ReactNode> = {
    profile: <ProfilePanel />,
    security: <SecurityPanel />,
    credits: <CreditsPanel />,
    keys: <KeysPanel limits={limits} origin={origin} />,
    data: (
      <div className="grid grid-cols-1 gap-4">
        {/* The cards below are third-level headings; this keeps the outline without a gap. */}
        <h2 className="sr-only">{t('account.tabs.data')}</h2>
        <AccountDataRights />
      </div>
    ),
  };

  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {user ? <Avatar name={user.name} size="lg" /> : null}
          <div className="grid min-w-0 grid-cols-1 gap-0.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t('account.title')}
            </h1>
            <p className="text-sm [overflow-wrap:anywhere] text-muted">
              {user ? (
                <>
                  {/* On a phone the name and the address each get a line instead of a dangling dot. */}
                  <span className="block font-medium text-foreground sm:inline">{user.name}</span>
                  <span aria-hidden="true" className="hidden sm:inline">
                    {' · '}
                  </span>
                  <span dir="ltr">{user.email}</span>
                </>
              ) : (
                t('account.header.subtitle')
              )}
            </p>
          </div>
        </div>
        <Button
          href="/account/billing"
          variant="secondary"
          startIcon={<CreditCard aria-hidden="true" className="size-4" />}
        >
          {t('account.header.billing')}
        </Button>
      </header>

      <Tabs value={tab} onValueChange={select}>
        <TabsList ref={tabList} aria-label={t('account.tabs.label')} className="edge-fade">
          {ACCOUNT_TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {TAB_ICONS[value]}
              {t(`account.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {ACCOUNT_TABS.map((value) => (
          <TabsContent key={value} value={value} keepMounted>
            {visited.has(value) ? panels[value] : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

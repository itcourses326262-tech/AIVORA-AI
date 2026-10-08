'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { UserProvider, type CurrentUser } from '@/lib/user-context';
import { cn } from '@/lib/utils';
import { Directional } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { Logo } from '../ui/logo';
import { Toaster } from '../ui/toast';
import { Tooltip } from '../ui/tooltip';
import { CreditsChip } from './credits-chip';
import { APP_NAV, isActivePath, type NavItem } from './nav';
import { serializeSidebarCookie } from './sidebar-cookie';
import { UserMenu } from './user-menu';

const SIDEBAR_ID = 'app-sidebar';

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useI18n();
  const active = isActivePath(usePathname(), item.href);
  const label = t(item.label);
  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'group relative flex h-11 items-center gap-3 rounded-xl text-sm font-medium transition-colors duration-150',
        collapsed ? 'justify-center px-0' : 'px-3',
        active
          ? 'bg-brand-soft text-foreground'
          : 'text-muted hover:bg-foreground/[0.06] hover:text-foreground',
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-2.5 start-0 w-[3px] rounded-full bg-brand-gradient"
        />
      ) : null}
      <item.icon
        aria-hidden="true"
        className={cn(
          'size-5 shrink-0 transition-colors',
          active ? 'text-brand' : 'group-hover:text-foreground',
        )}
      />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </Link>
  );
  return collapsed ? (
    <Tooltip content={label} side="end">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function BottomTab({ item }: { item: NavItem }) {
  const { t } = useI18n();
  const active = isActivePath(usePathname(), item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 pt-2 pb-1.5 text-[0.6875rem] font-medium transition-colors duration-150',
        active ? 'text-foreground' : 'text-muted active:text-foreground',
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-brand-gradient"
        />
      ) : null}
      <item.icon aria-hidden="true" className={cn('size-5', active && 'text-brand')} />
      <span className="max-w-full truncate">{t(item.shortLabel ?? item.label)}</span>
    </Link>
  );
}

export interface AppShellProps {
  /** The user the server resolved for this request. */
  initialUser: CurrentUser | null;
  /** Server-read state of the sidebar cookie, so the first paint is already right. */
  defaultCollapsed?: boolean;
  children: ReactNode;
}

/**
 * The signed-in frame. Desktop: a collapsible sidebar, a top bar with credits and the account
 * menu. Mobile: the top bar plus a bottom tab bar. It renders the page's one
 * `<main id="main-content">` and the toast region, and provides `useUser()` to everything inside.
 */
export function AppShell({ initialUser, defaultCollapsed = false, children }: AppShellProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = serializeSidebarCookie(next ? 'collapsed' : 'expanded', {
      secure: window.location.protocol === 'https:',
    });
  };

  return (
    <UserProvider initialUser={initialUser}>
      <div data-app-shell="" className="flex min-h-dvh">
        <aside
          id={SIDEBAR_ID}
          data-collapsed={collapsed}
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-border bg-surface transition-[width] duration-200 ease-out lg:flex',
            collapsed ? 'w-[4.75rem]' : 'w-64',
          )}
        >
          <div
            className={cn(
              'flex h-14 shrink-0 items-center border-b border-border',
              collapsed ? 'justify-center' : 'px-5',
            )}
          >
            <Link
              href="/"
              aria-label={t('common.a11y.home')}
              className="rounded-lg text-foreground"
            >
              {collapsed ? (
                <Logo variant="glyph" label={null} />
              ) : (
                <Logo label={null} className="h-7" />
              )}
            </Link>
          </div>
          <nav
            aria-label={t('common.a11y.appNavigation')}
            className={cn(
              'grid flex-1 content-start gap-1 overflow-y-auto py-4',
              collapsed ? 'px-3' : 'px-3',
            )}
          >
            {APP_NAV.map((item) => (
              <SidebarLink key={item.href} item={item} collapsed={collapsed} />
            ))}
          </nav>
          <div
            className={cn(
              'flex border-t border-border p-3',
              collapsed ? 'justify-center' : 'justify-end',
            )}
          >
            <IconButton
              label={collapsed ? t('common.a11y.expandSidebar') : t('common.a11y.collapseSidebar')}
              aria-expanded={!collapsed}
              aria-controls={SIDEBAR_ID}
              tooltip="end"
              size="sm"
              onClick={toggle}
            >
              <Directional>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Directional>
            </IconButton>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border surface-glass px-4 sm:px-6">
            <Link
              href="/"
              aria-label={t('common.a11y.home')}
              className="rounded-lg text-foreground lg:hidden"
            >
              <Logo variant="glyph" label={null} />
            </Link>
            <div className="ms-auto flex items-center gap-2">
              <CreditsChip />
              <UserMenu navigation={false} />
            </div>
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className="min-w-0 flex-1 pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] outline-none lg:pb-0"
          >
            {children}
          </main>
        </div>

        <nav
          aria-label={t('common.a11y.mobileNavigation')}
          className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] grid-cols-5 border-t border-border surface-glass pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {APP_NAV.map((item) => (
            <BottomTab key={item.href} item={item} />
          ))}
        </nav>
      </div>
      <Toaster />
    </UserProvider>
  );
}

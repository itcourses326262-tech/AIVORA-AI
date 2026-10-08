import type { ReactNode } from 'react';
import { getOptionalUser } from '@/lib/auth-guard';
import { UserProvider } from '@/lib/user-context';
import { Toaster } from '../ui/toast';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

/**
 * Header, footer, toasts and the user context for every public page. The `(marketing)` layout is
 * made of it, and public pages outside that group (explore, shared generations) can wrap
 * themselves in it too. The page itself renders its one `<main id="main-content">`.
 */
export async function SiteChrome({ children }: { children: ReactNode }) {
  const user = await getOptionalUser();
  return (
    <UserProvider initialUser={user}>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <div className="flex flex-1 flex-col">{children}</div>
        <SiteFooter signedIn={user !== null} />
      </div>
      <Toaster />
    </UserProvider>
  );
}

import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { cookies } from 'next/headers';
import { SIDEBAR_COOKIE } from '@/components/layout/sidebar-cookie';

export default async function KitAppPage() {
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === 'collapsed';
  return (
    <AppShell
      defaultCollapsed={collapsed}
      initialUser={{
        id: 'usr_x',
        email: 'layla@example.com',
        name: 'Layla Hassan',
        role: 'user',
        locale: 'en',
        creditBalance: 1250,
      }}
    >
      <div className="mx-auto grid max-w-5xl gap-6 p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">Studio</h1>
        <Badge variant="brand">demo</Badge>
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-96" />
      </div>
    </AppShell>
  );
}

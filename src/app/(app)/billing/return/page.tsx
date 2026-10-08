import type { Metadata } from 'next';
import { ReturnView } from '@/components/billing/return-view';
import { requireUser } from '@/lib/auth-guard';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('billing.meta.returnTitle'), robots: { index: false } };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const RETURN_PATH = '/billing/return';

/**
 * Where the payment provider (and the development checkout page) send the buyer back to. The
 * `order` parameter is only a name: the page asks the API what happened to that order, which the
 * server answers for the signed-in owner only.
 */
export default async function BillingReturnPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).order;
  const order = typeof raw === 'string' ? raw : (raw?.[0] ?? null);
  await requireUser(order ? `${RETURN_PATH}?order=${encodeURIComponent(order)}` : RETURN_PATH);
  return <ReturnView orderId={order} />;
}

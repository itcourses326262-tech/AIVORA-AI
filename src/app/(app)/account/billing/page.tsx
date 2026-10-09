import type { Metadata } from 'next';
import { BillingView } from '@/components/billing/billing-view';
import { requireUser } from '@/lib/auth-guard';
import { getI18n } from '@/lib/i18n/server';
import { buildCatalog } from '@/server/billing/catalog';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('billing.meta.billingTitle') };
}

/**
 * Billing for the signed-in user: balance, plan and payments. The page is only a frame: the plan
 * and the orders are read from `/api/v1/billing/*` by the browser, so a cancel or a payment made
 * in another tab shows up on the next visit. The app shell renders the page landmark.
 */
export default async function AccountBillingPage() {
  await requireUser('/account/billing');
  return <BillingView gateway={buildCatalog().gateway} />;
}

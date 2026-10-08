import type { OrderDTO } from '@/lib/api-types';
import { getPack, getPlan } from '@/lib/billing/plans';
import type { OrderKind } from '@/lib/billing/types';
import type { Locale } from '@/lib/i18n/locales';

/**
 * The display name of what an order bought, from the price list (`lib/billing/plans.ts`, shared
 * with the server). An item that has since left the list falls back to its id: the order still
 * shows, and the amount and credits on it are what was actually charged.
 */
export function itemName(kind: OrderKind, itemId: string, locale: Locale): string {
  const named = kind === 'pack' ? getPack(itemId) : getPlan(itemId);
  return named ? named.name[locale] : itemId;
}

export function orderItemName(order: Pick<OrderDTO, 'kind' | 'itemId'>, locale: Locale): string {
  return itemName(order.kind, order.itemId, locale);
}

export function planDisplayName(planId: string, locale: Locale): string {
  return itemName('subscription_initial', planId, locale);
}

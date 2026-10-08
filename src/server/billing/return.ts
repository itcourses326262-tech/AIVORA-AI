import 'server-only';
import { isValidId } from '@/lib/id';
import { getLogger } from '@/server/logger';
import { refreshOrder } from './settle';

/** The page that tells the buyer how their payment went (it polls `GET /billing/orders/:id`). */
export const RETURN_PAGE = '/billing/return';

/** A buyer who reloads the return page should not cost one gateway call per click. */
export const RETURN_MIN_CHECK_INTERVAL_MS = 2_000;

/**
 * The buyer's browser comes back from the payment page. Nothing in the request is believed: the
 * `order` parameter only has to LOOK like one of our ids, and the outcome is whatever the gateway's
 * API says when we ask. Returns the same-site path to redirect to, which only ever contains an
 * id that is in our database.
 */
export async function resolveReturn(
  orderParam: string | null | undefined,
  now: number = Date.now(),
): Promise<string> {
  if (!isValidId(orderParam, 'ord')) return RETURN_PAGE;
  try {
    const result = await refreshOrder(orderParam, {
      minIntervalMs: RETURN_MIN_CHECK_INTERVAL_MS,
      now,
    });
    if (!result) return RETURN_PAGE;
  } catch (error) {
    // The gateway is slow or down: the page polls and the scheduler keeps checking.
    getLogger().warn('Could not confirm a payment on return; it will be checked again', {
      module: 'billing',
      err: error,
    });
  }
  return `${RETURN_PAGE}?order=${orderParam}`;
}

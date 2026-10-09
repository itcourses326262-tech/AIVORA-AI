import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@/lib/id';

/**
 * The fake payment page and its Pay / Fail buttons stand in for the gateway during development.
 * In production they must not exist, whatever the order: a real order of the fake gateway cannot
 * be made there (billing is off or Moyasar), but the guard is the last line, so it is tested on its
 * own: the first thing both do is answer 404.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const NOT_FOUND = { digest: expect.stringContaining('404') };

async function payForm(): Promise<FormData> {
  const form = new FormData();
  form.set('orderId', newId('ord'));
  form.set('outcome', 'pay');
  return form;
}

describe('the fake checkout in production', () => {
  it('answers 404 to the Pay and Fail buttons before it looks at the order, the user or the gateway', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { completeMockCheckout } = await import('@/app/billing/mock-checkout/[orderId]/actions');
    await expect(completeMockCheckout(await payForm())).rejects.toMatchObject(NOT_FOUND);
  });

  it('answers 404 to the payment page of a well-formed order id', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { default: MockCheckoutPage } =
      await import('@/app/billing/mock-checkout/[orderId]/page');
    await expect(
      MockCheckoutPage({ params: Promise.resolve({ orderId: newId('ord') }) }),
    ).rejects.toMatchObject(NOT_FOUND);
  });

  it('is production that makes the difference: outside it both go on to ask who the user is', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { completeMockCheckout } = await import('@/app/billing/mock-checkout/[orderId]/actions');
    const { default: MockCheckoutPage } =
      await import('@/app/billing/mock-checkout/[orderId]/page');
    // No request here, so reading the session fails; what matters is that it is not the 404.
    await expect(completeMockCheckout(await payForm())).rejects.not.toMatchObject(NOT_FOUND);
    await expect(
      MockCheckoutPage({ params: Promise.resolve({ orderId: newId('ord') }) }),
    ).rejects.not.toMatchObject(NOT_FOUND);
  });
});

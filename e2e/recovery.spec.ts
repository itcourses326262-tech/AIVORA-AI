import { expect, test } from './fixtures';
import { ApiClient } from './fixtures/api';
import { linkTo, messagesTo, waitForEmail } from './fixtures/outbox';
import { expectSessionWorks, stealSession } from './fixtures/sessions';
import { TEST_PASSWORD } from './fixtures/users';
import { en } from './fixtures/i18n';

test.describe('password recovery by email', () => {
  // A used or made-up link is answered with a 400 by the reset route: the point of two tests here.
  test.use({ expectedConsoleErrors: [/status of 400 .*\/api\/v1\/auth\/password\/reset/] });

  test('a reset link sets a new password, ends every session and key, and works once', async ({
    page,
    account,
    api,
    freshContext,
    baseURL,
    playwright,
  }) => {
    const nextPassword = 'Recovered-Str0ng-pass-3!';
    const { key } = await api.createKey('before the reset');

    // Two sessions that exist before the reset: this browser's (copied before it is cleared to ask
    // for the link as a signed-out visitor) and another device's. Both must be dead on the server.
    const copy = await stealSession(page.context());
    const thief = await expectSessionWorks(copy, await freshContext(), baseURL ?? '', account.id);
    const otherDevice = new ApiClient((await freshContext()).request, baseURL ?? '');
    expect((await otherDevice.login(account.email, account.password)).status()).toBe(200);
    expect((await otherDevice.me())?.id).toBe(account.id);

    await test.step('ask for a link from the login page', async () => {
      await page.context().clearCookies();
      await page.goto('/login');
      await page.getByRole('link', { name: en('auth.login.forgot') }).click();
      await expect(page).toHaveURL(/\/forgot-password$/);
      await page.getByLabel('Email').fill(account.email);
      await page.getByRole('button', { name: en('auth.forgot.submit') }).click();
      await expect(page.getByRole('heading', { name: en('auth.forgot.sentTitle') })).toBeVisible();
      await expect(page.getByText(account.email)).toBeVisible();
    });

    const message = await waitForEmail(account.email);
    const link = linkTo(message, '/reset-password?token=');

    await test.step('the email is addressed to the owner and links to this site only', async () => {
      expect(message.subject).toMatch(/password/i);
      expect(link.startsWith(`${baseURL}/reset-password?token=`)).toBe(true);
      expect(message.html).toContain('<html');
      expect(message.html).not.toMatch(/<script|src="https?:/i);
    });

    await test.step('opening the link on another device, choosing a new password', async () => {
      const phone = await (await freshContext()).newPage();
      await phone.goto(link);
      await expect(
        phone.getByRole('heading', { level: 1, name: en('auth.reset.title') }),
      ).toBeVisible();
      await phone.getByLabel(/^New password/).fill(nextPassword);
      await phone.getByRole('button', { name: en('auth.reset.submit') }).click();
      await expect(
        phone.getByRole('heading', { name: en('auth.reset.successTitle') }),
      ).toBeVisible();
      await expect(phone.getByRole('link', { name: 'Log in' })).toBeVisible();
    });

    await test.step('the old password is dead, the new one works through the form', async () => {
      expect((await api.login(account.email, account.password)).status()).toBe(401);
      await page.goto('/login');
      await page.getByLabel('Email').fill(account.email);
      await page.getByLabel(/^Password/).fill(nextPassword);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page).toHaveURL(/\/studio/);
    });

    await test.step('every session that existed before the reset is dead on the server', async () => {
      expect(await thief.me()).toBeNull();
      expect(await otherDevice.me()).toBeNull();
      expect(await thief.statusOf('GET', '/api/v1/generations')).toBe(401);
    });

    await test.step('API keys made before the reset are revoked, a "password changed" notice goes out', async () => {
      const bare = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { authorization: `Bearer ${key}` },
      });
      try {
        expect((await bare.get('/api/v1/generations')).status()).toBe(401);
      } finally {
        await bare.dispose();
      }
      await expect
        .poll(async () => (await messagesTo(account.email)).length)
        .toBeGreaterThanOrEqual(2);
    });

    await test.step('the same link cannot be used again', async () => {
      const again = await (await freshContext()).newPage();
      await again.goto(link);
      await again.getByLabel(/^New password/).fill('Another-Str0ng-pass-4!');
      await again.getByRole('button', { name: en('auth.reset.submit') }).click();
      await expect(
        again.getByRole('heading', { name: 'This link was already used' }),
      ).toBeVisible();
      await expect(again.getByRole('link', { name: en('auth.reset.requestNew') })).toBeVisible();
    });
  });

  test('an unknown address gets the same answer and no email is sent', async ({
    page,
    account,
  }) => {
    const stranger = `nobody-${account.id}@example.com`;
    await page.context().clearCookies();
    await page.goto('/forgot-password');

    await test.step('the answer does not reveal whether the account exists', async () => {
      await page.getByLabel('Email').fill(stranger);
      await page.getByRole('button', { name: en('auth.forgot.submit') }).click();
      await expect(page.getByRole('heading', { name: en('auth.forgot.sentTitle') })).toBeVisible();
    });

    await test.step('a real request afterwards is delivered, and nothing went to the stranger', async () => {
      await page.getByRole('button', { name: en('auth.forgot.useAnother') }).click();
      await page.getByLabel('Email').fill(account.email);
      await page.getByRole('button', { name: en('auth.forgot.submit') }).click();
      await waitForEmail(account.email);
      expect(await messagesTo(stranger)).toEqual([]);
    });
  });

  test('a garbage or truncated link explains itself instead of failing silently', async ({
    freshContext,
  }) => {
    const page = await (await freshContext()).newPage();
    for (const target of ['/reset-password', '/reset-password?token=not-a-real-token']) {
      await page.goto(target);
      if (target.includes('token=')) {
        await page.getByLabel(/^New password/).fill(TEST_PASSWORD);
        await page.getByRole('button', { name: en('auth.reset.submit') }).click();
      }
      await expect(page.getByRole('heading', { name: 'This link does not work' })).toBeVisible();
      await expect(page.getByRole('link', { name: en('auth.reset.requestNew') })).toBeVisible();
    }
  });

  test('a failed reset attempt changes nothing about the account', async ({
    account,
    api,
    freshContext,
    baseURL,
  }) => {
    const visitor = new ApiClient((await freshContext()).request, baseURL ?? '');
    const attempt = await visitor.request.post('/api/v1/auth/password/reset', {
      data: { token: 'x'.repeat(43), password: 'Whatever-Str0ng-pass-5!' },
      headers: { origin: baseURL ?? '' },
    });
    expect(attempt.status()).toBe(400);
    expect((await api.me())?.email).toBe(account.email);
    expect((await api.login(account.email, account.password)).status()).toBe(200);
  });
});

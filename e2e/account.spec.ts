import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { readFile } from 'node:fs/promises';
import { ApiClient, createDemoImage, DEMO_IMAGE_MODEL, DEMO_WORDS } from './fixtures/api';
import { en, translate } from './fixtures/i18n';
import { storedFiles } from './fixtures/storage';
import { expectCredits } from './fixtures/studio';
import { TEST_PASSWORD, newAccountDetails } from './fixtures/users';

async function openAccount(page: Page, tab: string): Promise<void> {
  await page.goto(`/account?tab=${tab}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
}

// Every journey here starts signed in.
test.use({ signedIn: true });

test.describe('account: API keys', () => {
  test('create a key, use it against the API, then revoke it and see it refused', async ({
    page,
    api,
    playwright,
    baseURL,
  }) => {
    await openAccount(page, 'keys');
    await expect(page.getByRole('heading', { name: en('account.keys.empty.title') })).toBeVisible();

    let key = '';
    await test.step('create it and read the one-time secret', async () => {
      await page.getByRole('button', { name: 'Create key' }).click();
      await page
        .getByRole('textbox', { name: en('account.keys.createDialog.name') })
        .fill('CI pipeline');
      await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click();

      const reveal = page.getByRole('alertdialog', { name: en('account.keys.reveal.title') });
      await expect(reveal).toContainText('it will not be shown again');
      const secret = reveal.getByRole('textbox', { name: en('account.keys.reveal.keyLabel') });
      await expect(secret).toHaveValue(/^avk_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
      key = await secret.inputValue();
      await expect(reveal.getByRole('region', { name: /cURL/ })).toContainText(
        'Authorization: Bearer avk_',
      );
      await reveal.getByRole('button', { name: en('account.keys.reveal.done') }).click();
      await expect(reveal).toBeHidden();
    });

    await test.step('the list shows the key by its prefix and never by its secret', async () => {
      const row = page.getByRole('listitem').filter({ hasText: 'CI pipeline' });
      await expect(row).toContainText('Active');
      await expect(row).toContainText(en('account.keys.neverUsed'));
      await expect(row).not.toContainText(key);
      expect(await page.content()).not.toContain(key);
      expect(await api.listKeys()).toMatchObject([
        { name: 'CI pipeline', prefix: key.slice(0, 12) },
      ]);
    });

    const bearer = { authorization: `Bearer ${key}` };

    await test.step('with the key, page.request reads the models and the generation list', async () => {
      const models = await page.request.get('/api/v1/models', { headers: bearer });
      expect(models.status()).toBe(200);
      const catalog = ((await models.json()) as { data: Array<{ id: string; available: boolean }> })
        .data;
      expect(catalog.find((model) => model.id === DEMO_IMAGE_MODEL)?.available).toBe(true);

      const list = await page.request.get('/api/v1/generations', { headers: bearer });
      expect(list.status()).toBe(200);
      expect(((await list.json()) as { data: unknown[] }).data).toEqual([]);
    });

    await test.step('with no browser session at all, the key alone can generate', async () => {
      const bare = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bearer });
      try {
        const created = await bare.post('/api/v1/generations', {
          data: {
            tool: 'text-to-image',
            modelId: DEMO_IMAGE_MODEL,
            prompt: `Made through the API ${DEMO_WORDS.sync}`,
          },
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        expect(created.status()).toBe(201);
        const id = ((await created.json()) as { data: { id: string } }).data.id;
        await api.waitForStatus(id, 'succeeded');
        expect((await bare.get(`/api/v1/generations/${id}`)).status()).toBe(200);
        expect((await bare.get('/api/v1/account')).status()).toBe(200);
      } finally {
        await bare.dispose();
      }
      expect(await api.balance()).toBe(49);
    });

    await test.step('the keys list now says when it was last used', async () => {
      await page.reload();
      const row = page.getByRole('listitem').filter({ hasText: 'CI pipeline' });
      await expect(row).not.toContainText(en('account.keys.neverUsed'));
      await expect(row).toContainText('Last used');
    });

    await test.step('revoke it from the list, behind a confirmation', async () => {
      await page.getByRole('button', { name: 'Revoke CI pipeline' }).click();
      const dialog = page.getByRole('alertdialog', { name: /Revoke/ });
      await expect(dialog).toContainText('Anything using this key stops working immediately.');
      await dialog.getByRole('button', { name: en('account.keys.revokeConfirm') }).click();
      await expect(page.getByRole('listitem').filter({ hasText: 'CI pipeline' })).toContainText(
        en('account.keys.revokedStatus'),
      );
    });

    await test.step('the same key is now refused with 401, even next to a valid session', async () => {
      for (const path of ['/api/v1/generations', '/api/v1/account']) {
        const refused = await page.request.get(path, { headers: bearer });
        expect(refused.status(), path).toBe(401);
        expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
          'unauthorized',
        );
      }
      const bare = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bearer });
      try {
        expect((await bare.get('/api/v1/generations')).status()).toBe(401);
      } finally {
        await bare.dispose();
      }
    });
  });

  test('a made-up key is refused and a key cannot create more keys', async ({
    page,
    api,
    playwright,
    baseURL,
  }) => {
    const refused = await page.request.get('/api/v1/generations', {
      headers: { authorization: `Bearer avk_${'a'.repeat(8)}_${'b'.repeat(43)}` },
    });
    expect(refused.status()).toBe(401);

    const { key } = await api.createKey('limited');
    const bare = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${key}` },
    });
    try {
      const attempt = await bare.post('/api/v1/keys', { data: { name: 'escalation' } });
      expect(attempt.status()).toBe(403);
      expect((await bare.get('/api/v1/keys')).status()).toBe(403);
    } finally {
      await bare.dispose();
    }
    expect(await api.listKeys()).toHaveLength(1);
  });
});

test.describe('account: password', () => {
  test('changing it signs other devices out, keeps this one, and only the new password works', async ({
    page,
    account,
    api,
    freshContext,
    baseURL,
  }) => {
    const nextPassword = 'Another-Str0ng-pass-7!';

    const otherDevice = await freshContext();
    const otherClient = new ApiClient(otherDevice.request, baseURL ?? '');
    expect((await otherClient.login(account.email, account.password)).status()).toBe(200);
    expect((await otherClient.me())?.email).toBe(account.email);

    await openAccount(page, 'security');

    await test.step('a wrong current password and a weak new one are refused with a reason', async () => {
      await page.getByLabel(/^Current password/).fill('Not-my-password-1!');
      await page.getByLabel(/^New password/).fill(nextPassword);
      await page.getByRole('button', { name: en('account.security.submit') }).click();
      await expect(page.getByText(en('account.security.errors.currentWrong'))).toBeVisible();

      await page.getByLabel(/^Current password/).fill(account.password);
      await page.getByLabel(/^New password/).fill('password');
      await page.getByRole('button', { name: en('account.security.submit') }).click();
      await expect(page.getByText(en('auth.errors.passwordRejected'))).toBeVisible();
    });

    await test.step('a good one is accepted', async () => {
      await page.getByLabel(/^New password/).fill(nextPassword);
      await page.getByRole('button', { name: en('account.security.submit') }).click();
      await expect(page.getByText(en('account.security.success'))).toBeVisible();
    });

    await test.step('this browser stays signed in, the other device does not', async () => {
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
      expect((await api.me())?.email).toBe(account.email);
      expect(await otherClient.me()).toBeNull();
    });

    await test.step('the old password no longer logs in; the new one does, through the form', async () => {
      expect((await otherClient.login(account.email, account.password)).status()).toBe(401);

      await page.getByRole('button', { name: en('common.a11y.userMenu') }).click();
      await page.getByRole('menuitem', { name: en('common.nav.logout') }).click();
      await page.goto('/login');
      await page.getByLabel('Email').fill(account.email);
      await page.getByLabel(/^Password/).fill(nextPassword);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page).toHaveURL(/\/studio/);
    });
  });

  test('signing out of all devices ends every session', async ({
    page,
    account,
    freshContext,
    baseURL,
  }) => {
    const otherDevice = await freshContext();
    const other = new ApiClient(otherDevice.request, baseURL ?? '');
    await other.login(account.email, account.password);
    expect(await other.me()).not.toBeNull();

    await openAccount(page, 'security');
    await page.getByRole('button', { name: en('account.security.signOutButton') }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /Sign out/ })
      .click();
    await expect(page).toHaveURL(/\/login/);
    expect(await other.me()).toBeNull();
    await page.goto('/studio');
    await expect(page).toHaveURL(/\/login\?next=/);
  });
});

test.describe('account: language and theme', () => {
  test('choosing Arabic flips lang and dir, persists across reloads and is saved on the account', async ({
    page,
    api,
  }) => {
    const ar = translate('ar');
    await openAccount(page, 'profile');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await test.step('pick Arabic in the profile and save', async () => {
      await page.getByRole('radio', { name: en('common.language.ar') }).check();
      await page.getByRole('button', { name: en('account.profile.save') }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(
        page.getByRole('heading', { level: 1, name: ar('account.title') }),
      ).toBeVisible();
    });

    await test.step('it stays Arabic after a reload and on other pages', async () => {
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await page.goto('/studio');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(
        page.getByRole('heading', { level: 1, name: ar('studio.title') }),
      ).toBeAttached();
    });

    await test.step('the account remembers it', async () => {
      expect((await api.me())?.locale).toBe('ar');
    });

    await test.step('switching back from the account menu restores English', async () => {
      await page.getByRole('button', { name: ar('common.a11y.userMenu') }).click();
      await page.getByRole('menuitemradio', { name: en('common.language.en') }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    });
  });

  test('a visitor can switch the language on the public pages and it sticks', async ({
    freshContext,
  }) => {
    const page = await (await freshContext()).newPage();
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('button', { name: /^Language/ }).click();
    await page.getByRole('menuitemradio', { name: en('common.language.ar') }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.goto('/pricing');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('the theme toggle switches light and dark and remembers the choice', async ({ page }) => {
    await page.goto('/studio');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: en('common.a11y.userMenu') }).click();
    await page.getByRole('menuitemradio', { name: en('common.theme.light') }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .not.toBe('rgb(11, 11, 22)');

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.goto('/gallery');
    await expect(html).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: en('common.a11y.userMenu') }).click();
    await page.getByRole('menuitemradio', { name: en('common.theme.dark') }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });

  test('the system theme follows the browser preference', async ({ page }) => {
    await page.goto('/studio');
    await page.getByRole('button', { name: en('common.a11y.userMenu') }).click();
    await page.getByRole('menuitemradio', { name: en('common.theme.system') }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(246, 246, 251)');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(11, 11, 22)');
  });
});

test.describe('account: credits and data', () => {
  test('the credit history lists the welcome gift and every generation, newest first', async ({
    page,
    api,
  }) => {
    const created = await createDemoImage(api, 'A credit history picture');
    await openAccount(page, 'credits');
    await expectCredits(page, 49);

    const table = page.getByRole('table', { name: en('account.credits.historyTitle') });
    const rows = table.getByRole('row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText(en('account.credits.reasons.generation'));
    await expect(rows.nth(1)).toContainText('-1');
    await expect(rows.nth(1)).toContainText('49');
    await expect(rows.nth(2)).toContainText(en('account.credits.reasons.signup_bonus'));
    await expect(rows.nth(2)).toContainText('+50');
    await expect(rows.nth(1).getByRole('link')).toHaveAttribute('href', `/gallery/${created.id}`);
  });

  test('the data export is a JSON file of this account, without secrets', async ({
    page,
    account,
    api,
  }) => {
    await createDemoImage(api, 'Something to export');
    await api.createKey('exported key');
    await openAccount(page, 'data');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: en('auth.dataRights.export.button') }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^aivore-export-\d{4}-\d{2}-\d{2}\.json$/);

    const text = await readFile((await file.path()) ?? '', 'utf8');
    const data = JSON.parse(text) as {
      format: string;
      profile: { email: string; id: string };
      generations: unknown[];
    };
    expect(data.format).toBe('aivore-account-export/1');
    expect(data.profile.email).toBe(account.email);
    expect(data.profile.id).toBe(account.id);
    expect(data.generations).toHaveLength(1);
    expect(text).not.toMatch(/passwordHash|scrypt\$|"keyHash"|"tokenHash"/);
    expect(text).not.toContain(account.password);
  });

  test('deleting the account removes it, its shared pages and its sign-in', async ({
    page,
    account,
    api,
    freshContext,
    baseURL,
  }) => {
    const shared = await createDemoImage(api, 'Soon to disappear');
    await api.patchGeneration(shared.id, { isPublic: true });
    // An upload belongs to no generation and lives in a folder of its own.
    await api.uploadImage(await api.bytes(shared.outputs[0]?.url ?? ''), 'image/webp', 'mine.webp');
    const visitor = await freshContext();
    expect((await visitor.request.get(`/s/${shared.id}`)).status()).toBe(200);
    expect(await storedFiles(account.id, shared.id), 'the creation has files on disk').not.toEqual(
      [],
    );
    expect(await storedFiles(account.id, 'uploads'), 'the upload has files on disk').not.toEqual(
      [],
    );

    await openAccount(page, 'data');
    await page.getByRole('button', { name: en('auth.dataRights.delete.button') }).click();
    const dialog = page.getByRole('alertdialog', {
      name: en('auth.dataRights.delete.confirmTitle'),
    });

    await test.step('a wrong password does not delete anything', async () => {
      await dialog.getByLabel(/^Enter your password to confirm/).fill('Not-my-password-1!');
      await dialog.getByRole('button', { name: en('auth.dataRights.delete.submit') }).click();
      await expect(dialog.getByText(en('auth.dataRights.delete.wrongPassword'))).toBeVisible();
      expect((await api.me())?.email).toBe(account.email);
    });

    await test.step('the right password deletes it and signs this browser out', async () => {
      await dialog.getByLabel(/^Enter your password to confirm/).fill(account.password);
      await dialog.getByRole('button', { name: en('auth.dataRights.delete.submit') }).click();
      await expect(page).not.toHaveURL(/\/account/);
      expect(await api.me()).toBeNull();
    });

    await test.step('the shared page and its picture are gone, and the credentials are dead', async () => {
      await expect
        .poll(async () => (await visitor.request.get(`/s/${shared.id}`)).status())
        .toBe(404);
      expect((await visitor.request.get(shared.outputs[0]?.url ?? '')).status()).toBe(404);
      // The pictures themselves are erased, not only unlinked: nothing of the account is left on disk.
      await expect.poll(() => storedFiles(account.id)).toEqual([]);
      const login = await new ApiClient(visitor.request, baseURL ?? '').login(
        account.email,
        account.password,
      );
      expect(login.status()).toBe(401);
    });

    await test.step('the same address can register again as a brand-new account', async () => {
      const again = new ApiClient(visitor.request, baseURL ?? '');
      const user = await again.register({
        ...newAccountDetails(),
        email: account.email,
        password: TEST_PASSWORD,
      });
      expect(user.id).not.toBe(account.id);
    });
  });
});

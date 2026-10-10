import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { newAccountDetails } from './fixtures/users';
import { STUDIO_URL } from './fixtures/urls';
import { en } from './fixtures/i18n';

/** What the page told the browser's Credential Management API, recorded by `watchCredentials`. */
interface CredentialLog {
  stored: Array<{ id: string; password: string; name: string }>;
  silentAccessPrevented: number;
  asked: number;
}

declare global {
  interface Window {
    __credentials?: CredentialLog;
  }
}

/**
 * Chromium shows "Save password?" from `navigator.credentials.store`; a test cannot click that
 * bubble, so the calls are recorded instead (and the real ones are not made).
 */
async function watchCredentials(page: Page) {
  await page.addInitScript(() => {
    const log: CredentialLog = { stored: [], silentAccessPrevented: 0, asked: 0 };
    window.__credentials = log;
    const credentials = navigator.credentials;
    if (!credentials) return;
    Object.assign(credentials, {
      store: async (credential: { id: string; password: string; name: string }) => {
        log.stored.push({
          id: credential.id,
          password: credential.password,
          name: credential.name,
        });
      },
      preventSilentAccess: async () => {
        log.silentAccessPrevented += 1;
      },
      get: async () => {
        log.asked += 1;
        return null;
      },
    });
  });
}

const credentialLog = (page: Page) => page.evaluate(() => window.__credentials);

test.describe('the browser can save and fill the login', () => {
  test('log in is a real form whose fields say what they are', async ({ page }) => {
    await page.goto('/login');
    const form = page.locator('form');
    await expect(form).toHaveCount(1);
    await expect(form).toHaveAttribute('method', 'post');

    const email = form.locator('input#email');
    await expect(email).toHaveAttribute('name', 'email');
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'username');
    const password = form.locator('input#password');
    await expect(password).toHaveAttribute('name', 'password');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await expect(form.getByRole('button', { name: en('auth.login.submit') })).toHaveAttribute(
      'type',
      'submit',
    );
  });

  test('sign up has the name, the email as login name and a new password', async ({ page }) => {
    await page.goto('/register');
    const form = page.locator('form');
    await expect(form).toHaveCount(1);
    await expect(form.locator('input#name')).toHaveAttribute('autocomplete', 'name');
    await expect(form.locator('input#email')).toHaveAttribute('autocomplete', 'username');
    await expect(form.locator('input#password')).toHaveAttribute('autocomplete', 'new-password');
  });

  test('asking for a reset link keeps a plain email field', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.locator('form input#email')).toHaveAttribute('autocomplete', 'email');
  });

  test('a deployed site shows no development placeholder where the Google button would be', async ({
    page,
  }) => {
    for (const path of ['/login', '/register']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(en('auth.google.dev.title'))).toHaveCount(0);
      await expect(page.getByText(en('auth.google.dev.note'))).toHaveCount(0);
      await expect(page.getByRole('button', { name: en('auth.google.button') })).toHaveCount(0);
      expect(await page.content()).not.toContain('setup:firebase');
    }
  });

  test('signing up hands the new login to the browser, once, and never asks for a saved one', async ({
    page,
  }) => {
    const details = newAccountDetails();
    await watchCredentials(page);
    await page.goto('/register');
    await page.getByLabel('Name').fill(details.name);
    await page.getByLabel('Email').fill(details.email);
    await page.getByLabel(/^Password/).fill(details.password);
    expect((await credentialLog(page))?.stored).toEqual([]);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(STUDIO_URL);
    const log = await credentialLog(page);
    expect(log?.stored).toEqual([
      { id: details.email, password: details.password, name: details.name },
    ]);
    expect(log?.asked).toBe(0);
  });

  test('a wrong password is not offered to the browser', async ({ page, account }) => {
    await page.context().clearCookies();
    await watchCredentials(page);
    await page.goto('/login');
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel(/^Password/).fill('Not-the-password-1!');
    await page.getByRole('button', { name: en('auth.login.submit') }).click();
    await expect(page.getByText(en('auth.errors.invalidCredentials'))).toBeVisible();
    expect((await credentialLog(page))?.stored).toEqual([]);
  });

  test('logging in stores the login, and logging out stops a silent sign-in', async ({
    page,
    account,
  }) => {
    await page.context().clearCookies();
    await watchCredentials(page);
    await page.goto('/login');
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel(/^Password/).fill(account.password);
    await page.getByRole('button', { name: en('auth.login.submit') }).click();
    await expect(page).toHaveURL(STUDIO_URL);
    expect((await credentialLog(page))?.stored).toEqual([
      { id: account.email, password: account.password, name: '' },
    ]);
    expect((await credentialLog(page))?.silentAccessPrevented).toBe(0);

    await page.getByRole('button', { name: en('common.a11y.userMenu') }).click();
    await page.getByRole('menuitem', { name: en('common.nav.logout') }).click();
    await expect(page).not.toHaveURL(/\/studio/);
    const log = await credentialLog(page);
    expect(log?.silentAccessPrevented).toBe(1);
    expect(log?.asked).toBe(0);
  });
});

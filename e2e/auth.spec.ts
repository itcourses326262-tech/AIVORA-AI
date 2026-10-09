import { expect, test } from './fixtures';
import { newAccountDetails } from './fixtures/users';
import { ApiClient } from './fixtures/api';
import { expectSessionWorks, stealSession } from './fixtures/sessions';
import { STUDIO_URL, sitePath } from './fixtures/urls';
import { en } from './fixtures/i18n';

test.describe('authentication', () => {
  test('registering lands in the studio with the sign-up credits', async ({ page }) => {
    const details = newAccountDetails();

    await test.step('fill in and submit the registration form', async () => {
      await page.goto('/register');
      await expect(
        page.getByRole('heading', { level: 1, name: en('auth.register.title') }),
      ).toBeVisible();
      await page.getByLabel('Name').fill(details.name);
      await page.getByLabel('Email').fill(details.email);
      await page.getByLabel(/^Password/).fill(details.password);
      await page.getByRole('button', { name: en('auth.register.submit') }).click();
    });

    await test.step('land on the studio, signed in, with the 50 sign-up credits', async () => {
      await expect(page).toHaveURL(STUDIO_URL);
      await expect(page.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible();
      await expect(
        page.getByRole('link', { name: en('common.credits.balance', { amount: 50 }) }),
      ).toBeVisible();
    });
  });

  test('an email address is the same account however it is capitalised', async ({
    page,
    account,
  }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('Email').fill(account.email.toUpperCase());
    await page.getByLabel(/^Password/).fill(account.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(STUDIO_URL);
    await expect(
      page.getByRole('link', { name: en('common.credits.balance', { amount: 50 }) }),
    ).toBeVisible();
  });

  test('a password that is too common is refused while registering', async ({ page }) => {
    const details = newAccountDetails();
    await page.goto('/register');
    await page.getByLabel('Name').fill(details.name);
    await page.getByLabel('Email').fill(details.email);
    await page.getByLabel(/^Password/).fill('password');
    await page.getByRole('button', { name: en('auth.register.submit') }).click();
    await expect(page.getByText(en('auth.errors.passwordRejected'))).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('registering with a taken email says so instead of creating a second account', async ({
    page,
    account,
  }) => {
    await page.context().clearCookies();
    await page.goto('/register');
    await page.getByLabel('Name').fill('Someone Else');
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel(/^Password/).fill(account.password);
    await page.getByRole('button', { name: en('auth.register.submit') }).click();

    await expect(page.getByText(en('auth.errors.emailTaken'))).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('logging out ends the session on the server and logging in again restores it', async ({
    page,
    account,
    api,
    freshContext,
    baseURL,
  }) => {
    await page.goto('/studio');
    await expect(
      page.getByRole('link', { name: en('common.credits.balance', { amount: 50 }) }),
    ).toBeVisible();
    // The browser forgets its cookie when it logs out; a copy of that cookie is what shows whether
    // the session itself is gone from the server.
    const copy = await stealSession(page.context());
    const thief = await expectSessionWorks(copy, await freshContext(), baseURL ?? '', account.id);

    await test.step('log out from the account menu', async () => {
      await page.getByRole('button', { name: en('common.a11y.userMenu') }).click();
      await page.getByRole('menuitem', { name: en('common.nav.logout') }).click();
      await expect(page).not.toHaveURL(/\/studio/);
      expect(await api.me()).toBeNull();
    });

    await test.step('a copy of the old session cookie is dead too', async () => {
      expect(await thief.me()).toBeNull();
      expect(await thief.statusOf('GET', '/api/v1/generations')).toBe(401);
    });

    await test.step('the studio is closed to a visitor again', async () => {
      await page.goto('/studio');
      await expect(page).toHaveURL(/\/login\?next=%2Fstudio$/);
    });

    await test.step('log in with the same credentials', async () => {
      await page.getByLabel('Email').fill(account.email);
      await page.getByLabel(/^Password/).fill(account.password);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page).toHaveURL(STUDIO_URL);
      expect((await api.me())?.email).toBe(account.email);
    });
  });

  test('a wrong password and an unknown email get the same generic error', async ({
    page,
    account,
  }) => {
    await page.context().clearCookies();
    await page.goto('/login');

    const attempt = async (email: string, password: string) => {
      await page.getByLabel('Email').fill(email);
      await page.getByLabel(/^Password/).fill(password);
      await page.getByRole('button', { name: 'Log in' }).click();
    };

    await test.step('right email, wrong password', async () => {
      await attempt(account.email, 'Not-the-password-1!');
      await expect(page.getByText(en('auth.errors.invalidCredentials'))).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
    });

    await test.step('unknown email', async () => {
      await attempt(`nobody-${account.id}@example.com`, 'Not-the-password-1!');
      await expect(page.getByText(en('auth.errors.invalidCredentials'))).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
    });

    await test.step('empty fields are caught before any request', async () => {
      await page.reload();
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page.getByText(en('auth.validation.emailRequired'))).toBeVisible();
      await expect(page.getByText(en('auth.validation.passwordRequired'))).toBeVisible();
    });
  });

  test('a protected page sends a visitor to the login page and back after logging in', async ({
    page,
    account,
  }) => {
    await page.context().clearCookies();

    await page.goto('/studio');
    await expect(page).toHaveURL(/\/login\?next=%2Fstudio$/);

    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel(/^Password/).fill(account.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(STUDIO_URL);
    await expect(page.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible();
  });

  test('a deep link keeps its query string through the login', async ({ page, account }) => {
    await page.context().clearCookies();

    await page.goto('/account?tab=security');
    await expect(page).toHaveURL(/\/login\?next=%2Faccount%3Ftab%3Dsecurity$/);

    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel(/^Password/).fill(account.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/account\?tab=security$/);
    await expect(
      page.getByRole('tab', { name: en('account.tabs.security'), selected: true }),
    ).toBeVisible();
  });

  for (const hostile of ['//evil.example', 'https://evil.example/phish', '/\\evil.example']) {
    test(`an off-site next=${hostile} is ignored after logging in`, async ({
      page,
      account,
      baseURL,
    }) => {
      await page.context().clearCookies();
      await page.goto(`/login?next=${encodeURIComponent(hostile)}`);
      await page.getByLabel('Email').fill(account.email);
      await page.getByLabel(/^Password/).fill(account.password);
      await page.getByRole('button', { name: 'Log in' }).click();

      await expect(page).toHaveURL(sitePath(baseURL, '/studio'));
      expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? '').origin);
    });
  }

  test('an off-site next is ignored after registering too', async ({ page, baseURL }) => {
    const details = newAccountDetails();
    await page.goto(`/register?next=${encodeURIComponent('//evil.example')}`);
    await page.getByLabel('Name').fill(details.name);
    await page.getByLabel('Email').fill(details.email);
    await page.getByLabel(/^Password/).fill(details.password);
    await page.getByRole('button', { name: en('auth.register.submit') }).click();
    await expect(page).toHaveURL(sitePath(baseURL, '/studio'));
  });

  test.describe('signed in', () => {
    test.use({ signedIn: true });

    test('a session cookie is HttpOnly so page scripts cannot read it', async ({ page }) => {
      await page.goto('/studio');
      expect(await page.evaluate(() => document.cookie)).not.toContain('aivore_session');
      const cookies = await page.context().cookies();
      const session = cookies.find((cookie) => cookie.name === 'aivore_session');
      expect(session?.httpOnly).toBe(true);
      expect(session?.sameSite).toBe('Lax');
    });
  });

  test('API sessions are independent: logging in elsewhere does not log this browser out', async ({
    page,
    account,
    baseURL,
    playwright,
  }) => {
    await page.goto('/studio');
    const elsewhere = await playwright.request.newContext({ baseURL });
    try {
      const other = new ApiClient(elsewhere, baseURL ?? '');
      const response = await other.login(account.email, account.password);
      expect(response.status()).toBe(200);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible();
    } finally {
      await elsewhere.dispose();
    }
  });
});

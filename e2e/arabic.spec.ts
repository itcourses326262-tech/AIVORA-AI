import { expect, test } from './fixtures';
import { createDemoImage } from './fixtures/api';
import { translate } from './fixtures/i18n';
import { setPreferences } from './fixtures/preferences';
import { STUDIO_URL } from './fixtures/urls';
import { newAccountDetails } from './fixtures/users';

// The owner and most of the audience read Arabic: the main journeys must work in it, right to left.
const t = translate('ar');

test.beforeEach(async ({ context, baseURL }) => {
  await setPreferences(context, baseURL ?? '', { locale: 'ar' });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('Arabic: sign-up and log in', () => {
  test('registering lands in a right-to-left studio with the Arabic balance', async ({ page }) => {
    const details = newAccountDetails();
    await page.goto('/register');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByRole('heading', { level: 1, name: t('auth.register.title') }),
    ).toBeVisible();

    await page.getByLabel(t('auth.fields.name')).fill(details.name);
    await page.getByLabel(t('auth.fields.email')).fill(details.email);
    await page
      .getByLabel(new RegExp(`^${escapeRegExp(t('auth.fields.password'))}`))
      .fill(details.password);
    await page.getByRole('button', { name: t('auth.register.submit') }).click();

    await expect(page).toHaveURL(STUDIO_URL);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: t('studio.title') })).toBeAttached();
    await expect(
      page.getByRole('link', { name: t('common.credits.balance', { amount: 50 }) }),
    ).toBeVisible();
  });

  test('a wrong password is explained in Arabic', async ({ page, account, baseURL }) => {
    await page.context().clearCookies();
    await setPreferences(page.context(), baseURL ?? '', { locale: 'ar' });
    await page.goto('/login');
    await page.getByLabel(t('auth.fields.email')).fill(account.email);
    await page
      .getByLabel(new RegExp(`^${escapeRegExp(t('auth.fields.password'))}`))
      .fill('Wrong-pass-123!');
    await page.getByRole('button', { name: t('auth.login.submit') }).click();
    await expect(page.getByText(t('auth.errors.invalidCredentials'))).toBeVisible();
  });
});

test.describe('Arabic: creating and finding work', () => {
  test.use({ signedIn: true });

  test('an Arabic prompt makes a picture, and the card and the balance speak Arabic', async ({
    page,
    api,
  }) => {
    const prompt = 'منارة وحيدة على جرف عند الغروب';
    await page.goto('/studio');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const generate = page.getByRole('button', {
      name: new RegExp(`^${escapeRegExp(t('studio.generate'))}`),
    });
    await expect(generate).toBeEnabled();
    await page.getByRole('textbox', { name: t('studio.prompt.label') }).fill(prompt);
    await generate.click();

    const ready = page.getByRole('article', {
      name: new RegExp(
        `${escapeRegExp(prompt)}.*${escapeRegExp(t('studio.generations.status.succeeded'))}$`,
      ),
    });
    await expect(ready).toBeVisible({ timeout: 45_000 });
    await expect(ready.getByRole('img').first()).toBeVisible();
    await expect(ready.getByText(prompt)).toHaveAttribute('dir', 'auto');
    await expect(
      page.getByRole('link', { name: t('common.credits.balance', { amount: 49 }) }),
    ).toBeVisible();
    expect((await api.listGenerations())[0]?.prompt).toBe(prompt);
  });

  test('an Arabic prompt that breaks the policy is refused in Arabic and costs nothing', async ({
    page,
    api,
  }) => {
    await page.goto('/studio');
    const generate = page.getByRole('button', {
      name: new RegExp(`^${escapeRegExp(t('studio.generate'))}`),
    });
    await expect(generate).toBeEnabled();
    await page
      .getByRole('textbox', { name: t('studio.prompt.label') })
      .fill('تصوير عنف دموي بقطع الرؤوس');
    await generate.click();

    await expect(
      page
        .getByRole('tabpanel')
        .getByRole('alert')
        .filter({ hasText: t('errors.moderation_blocked') }),
    ).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
    expect(await api.balance()).toBe(50);
    expect(await api.listGenerations()).toEqual([]);
  });

  test('the gallery searches Arabic prompts', async ({ page, api }) => {
    const arabic = await createDemoImage(api, 'قطة برتقالية تطفو بين السدم الملونة');
    await createDemoImage(api, 'A fluffy cat floating through nebulae');
    await page.goto('/gallery');
    await expect(page.getByRole('heading', { level: 1, name: t('gallery.title') })).toBeVisible();
    const cards = page
      .getByRole('region', { name: t('gallery.list.results') })
      .getByRole('article');
    await expect(cards).toHaveCount(2);

    await page.getByRole('textbox', { name: t('gallery.list.search.label') }).fill('برتقالية');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('قطة برتقالية');
    await expect(page.getByRole('link', { name: new RegExp('قطة برتقالية') })).toHaveAttribute(
      'href',
      `/gallery/${arabic.id}`,
    );
  });
});

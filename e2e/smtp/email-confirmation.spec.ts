import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { ApiClient, DEMO_IMAGE_MODEL, DEMO_WORDS } from '../fixtures/api';
import { en } from '../fixtures/i18n';
import { linkTo, waitForEmail, waitForEmailLinking } from '../fixtures/outbox';
import { creditsChip, expectCredits, generateButton, promptBox } from '../fixtures/studio';
import { STUDIO_URL, sitePath } from '../fixtures/urls';
import { newAccountDetails, uniquePrompt, type TestAccount } from '../fixtures/users';

/**
 * The production default: a mail relay is configured, so `EMAIL_VERIFICATION=auto` means a new
 * account has to confirm its address before it can create anything, and the sign-up credits arrive
 * with the confirmation. This project's server delivers through real SMTP to a sink (see
 * `playwright.config.ts`); the default project has no relay and so skips all of this.
 */

const SMTP_MAIL = 'smtp' as const;

type Details = Omit<TestAccount, 'id'>;

async function registerThroughTheForm(page: Page, details: Details): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Name').fill(details.name);
  await page.getByLabel('Email').fill(details.email);
  await page.getByLabel(/^Password/).fill(details.password);
  await page.getByRole('button', { name: en('auth.register.submit') }).click();
  await expect(page).toHaveURL(STUDIO_URL);
}

function banner(page: Page) {
  return page.getByRole('region', { name: en('auth.banner.label') });
}

test.describe('email confirmation (a mail relay is configured)', () => {
  // A used or made-up link is answered with a 400 by the confirmation route.
  test.use({
    expectedConsoleErrors: [/status of 400 .*\/api\/v1\/auth\/verify-email\/confirm/],
  });

  test('a new account cannot create until it confirms; the link adds the sign-up credits', async ({
    page,
    context,
    baseURL,
    freshContext,
  }) => {
    const details = newAccountDetails();
    const api = new ApiClient(context.request, baseURL ?? '');

    await test.step('registering lands in the studio, which asks for the confirmation first', async () => {
      await registerThroughTheForm(page, details);
      await expect(banner(page)).toContainText(details.email);
      await expect(banner(page)).toContainText('50 credits');
      // The server asks for a gap of 60 seconds between two links, and the first one has just gone.
      await expect(banner(page).getByRole('button', { name: /^Resend in / })).toBeDisabled();
      await expectCredits(page, 0);
      await expect(page.getByText(en('studio.confirmEmail.title'))).toBeVisible();
      await promptBox(page).fill(uniquePrompt('Not allowed yet'));
      await expect(generateButton(page)).toBeDisabled();
    });

    await test.step('the server agrees: no generation, and nothing is charged or created', async () => {
      const me = await api.me();
      expect(me).toMatchObject({
        emailVerified: false,
        emailVerificationRequired: true,
        pendingBonusCredits: 50,
        creditBalance: 0,
      });
      const refused = await api.tryCreateGeneration({
        tool: 'text-to-image',
        modelId: DEMO_IMAGE_MODEL,
        prompt: `Before confirming ${DEMO_WORDS.sync}`,
      });
      expect(refused).toMatchObject({ status: 403, code: 'email_not_verified' });
      expect(await api.listGenerations()).toEqual([]);
    });

    const message = await waitForEmail(details.email, 0, SMTP_MAIL);
    const link = linkTo(message, '/verify-email?token=');

    await test.step('the mail came through SMTP, is addressed to the person and links to this site only', async () => {
      expect(message.subject).toMatch(/confirm/i);
      expect(link.startsWith(`${baseURL}/verify-email?token=`)).toBe(true);
      expect(message.text).toContain(details.firstName);
      expect(message.html).toContain('<html');
      expect(message.html).not.toMatch(/<script|src="https?:/i);
    });

    await test.step('opening the link on a phone (another browser, signed out) confirms the address', async () => {
      const phone = await (await freshContext()).newPage();
      await phone.goto(link);
      await expect(
        phone.getByRole('heading', { name: en('auth.verify.successTitle') }),
      ).toBeVisible();
      await expect(phone.getByText('50 credits were added to your balance.')).toBeVisible();
      // The token leaves the address bar once it has been used.
      await expect(phone).toHaveURL(sitePath(baseURL, '/verify-email'));
    });

    await test.step('the studio that was waiting notices by itself, and now lets the person create', async () => {
      // Coming back to the window re-reads the account (at most every few seconds).
      await expect(async () => {
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expectCredits(page, 50);
      }).toPass();
      await expect(banner(page)).toHaveCount(0);
      await expect(page.getByText(en('studio.confirmEmail.title'))).toHaveCount(0);
      await expect(generateButton(page)).toBeEnabled();

      const prompt = uniquePrompt('First picture after confirming');
      await promptBox(page).fill(`${prompt} ${DEMO_WORDS.sync}`);
      await generateButton(page).click();
      await expect(page.getByRole('article', { name: new RegExp(prompt) })).toBeVisible();
      await expectCredits(page, 49);
    });

    await test.step('the ledger holds one sign-up bonus, granted at the confirmation, and one charge', async () => {
      const reasons = (await api.ledger()).map((entry) => entry.reason).sort();
      expect(reasons).toEqual(['generation', 'signup_bonus']);
      expect(await api.balance()).toBe(49);
    });

    await test.step('the same link cannot be used a second time', async () => {
      const again = await (await freshContext()).newPage();
      await again.goto(link);
      await expect(
        again.getByRole('heading', { name: en('auth.verify.problem.used.title') }),
      ).toBeVisible();
      expect(await api.balance()).toBe(49);
    });
  });

  test('a garbage or truncated confirmation link explains itself and changes nothing', async ({
    freshContext,
  }) => {
    const page = await (await freshContext()).newPage();
    for (const target of ['/verify-email', '/verify-email?token=not-a-real-token']) {
      await page.goto(target);
      await expect(
        page.getByRole('heading', { name: en('auth.verify.problem.invalid.title') }),
      ).toBeVisible();
    }
  });

  test('a reset link also proves the mailbox: it confirms the address and adds the sign-up credits', async ({
    page,
    context,
    baseURL,
    freshContext,
  }) => {
    const details = newAccountDetails();
    const api = new ApiClient(context.request, baseURL ?? '');
    await api.register(details);
    expect(await api.balance()).toBe(0);
    await context.clearCookies();

    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(details.email);
    await page.getByRole('button', { name: en('auth.forgot.submit') }).click();
    await expect(page.getByRole('heading', { name: en('auth.forgot.sentTitle') })).toBeVisible();

    // The confirmation link sent at registration is in the sink too; this one is the reset link.
    const message = await waitForEmailLinking(details.email, '/reset-password?token=', SMTP_MAIL);
    const link = linkTo(message, '/reset-password?token=');
    const phone = await (await freshContext()).newPage();
    await phone.goto(link);
    await phone.getByLabel(/^New password/).fill('Recovered-Str0ng-pass-3!');
    await phone.getByRole('button', { name: en('auth.reset.submit') }).click();
    await expect(phone.getByRole('heading', { name: en('auth.reset.successTitle') })).toBeVisible();

    const login = await api.login(details.email, 'Recovered-Str0ng-pass-3!');
    expect(login.status()).toBe(200);
    expect(await api.me()).toMatchObject({ emailVerified: true, creditBalance: 50 });
    await page.goto('/studio');
    await expect(creditsChip(page)).toBeVisible();
  });
});

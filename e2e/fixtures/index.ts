import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { ApiClient } from './api';
import { createConsoleWatch, type ConsoleWatch } from './console';
import { newAccountDetails, type TestAccount } from './users';

interface TestOptions {
  /** Registers an account in the test's browser context before the test starts (`page` is then signed in). */
  signedIn: boolean;
  /** Console errors a test provokes on purpose (a refused request, a blocked resource). */
  expectedConsoleErrors: RegExp[];
}

interface TestFixtures {
  /** Internal: every page of the test, in any browser context it opens, is watched through this. */
  consoleWatch: ConsoleWatch;
  /** Internal: registers the test's account on first use. */
  accountSlot: () => Promise<TestAccount>;
  /** Internal: signs in up front when `signedIn` is set. */
  session: void;
  /** A freshly registered, signed-in account. `page`, `context` and `api` all share its session. */
  account: TestAccount;
  /** The HTTP API, called with the signed-in browser session (cookies are shared with `page`). */
  api: ApiClient;
  /** Opens a second, independent browser context (own cookies): another user, or a visitor. */
  freshContext: () => Promise<BrowserContext>;
  /** Registers another account in its own context and returns what a test needs to act as it. */
  otherUser: () => Promise<{
    account: TestAccount;
    api: ApiClient;
    context: BrowserContext;
    page: Page;
  }>;
}

export const test = base.extend<TestFixtures & TestOptions>({
  expectedConsoleErrors: [[], { option: true }],
  signedIn: [false, { option: true }],

  // Any uncaught exception or console error in any page of the test is a product defect, whatever
  // the test was about (`console.ts` says what is not). This fixture is set up first and torn down
  // last, so it sees the pages of `freshContext` and `otherUser` contexts that are closed before.
  consoleWatch: [
    async ({ expectedConsoleErrors }, provide) => {
      const problems: string[] = [];
      await provide(createConsoleWatch(problems, expectedConsoleErrors));
      expect(problems, 'no page should log an error or throw').toEqual([]);
    },
    { auto: true },
  ],

  // The default context, and so `page` and every popup it opens.
  context: async ({ context, consoleWatch }, provide) => {
    consoleWatch.context(context);
    await provide(context);
  },

  // One registration per test, made the first time something asks for it.
  accountSlot: async ({ context, baseURL }, provide) => {
    let registered: Promise<TestAccount> | undefined;
    await provide(() => {
      registered ??= (async () => {
        const details = newAccountDetails();
        const user = await new ApiClient(context.request, requireBaseUrl(baseURL)).register(
          details,
        );
        return { ...details, id: user.id };
      })();
      return registered;
    });
  },

  session: [
    async ({ signedIn, accountSlot }, provide) => {
      if (signedIn) await accountSlot();
      await provide();
    },
    { auto: true },
  ],

  account: async ({ accountSlot }, provide) => {
    await provide(await accountSlot());
  },

  api: async ({ account, context, baseURL }, provide) => {
    void account;
    await provide(new ApiClient(context.request, requireBaseUrl(baseURL)));
  },

  freshContext: async ({ browser, baseURL, consoleWatch }, provide) => {
    const opened: BrowserContext[] = [];
    await provide(async () => {
      const context = await browser.newContext({ baseURL, locale: 'en-US' });
      consoleWatch.context(context);
      opened.push(context);
      return context;
    });
    await Promise.all(opened.map((context) => context.close()));
  },

  otherUser: async ({ freshContext, baseURL }, provide) => {
    await provide(async () => {
      const context = await freshContext();
      const details = newAccountDetails();
      const api = new ApiClient(context.request, requireBaseUrl(baseURL));
      const user = await api.register(details);
      return { account: { ...details, id: user.id }, api, context, page: await context.newPage() };
    });
  },
});

export { expect };

function requireBaseUrl(baseURL: string | undefined): string {
  if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL');
  return baseURL;
}

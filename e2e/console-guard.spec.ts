import { expect, test } from './fixtures';
import { createConsoleWatch } from './fixtures/console';

/**
 * The guard that fails every test on a console error or an uncaught exception must itself be
 * proven to catch what it claims to, in a real browser: a broken picture, a missing script, a
 * picture of the media route that does not load, an exception in a page opened later. These
 * contexts are made by hand, outside the fixtures, so the failures the probes provoke are collected
 * here instead of failing this test.
 */

const PROBE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>probe</title></head>
<body>
  <img src="/missing-hero.png" alt="">
  <script src="/missing-script.js"></script>
  <img src="/api/v1/media/ast_00000000000000000000000000" alt="">
  <script>
    fetch('/api/v1/generations/gen_00000000000000000000000000');
    setTimeout(() => { throw new Error('boom'); }, 0);
  </script>
</body></html>`;

test.describe('the console guard', () => {
  test('reports broken assets and exceptions, but not the API refusing a request', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL });
    try {
      const problems: string[] = [];
      createConsoleWatch(problems).context(context);
      await context.route('**/__probe*', (route) =>
        route.fulfill({ contentType: 'text/html', body: PROBE }),
      );

      const page = await context.newPage();
      await page.goto('/__probe');
      await expect.poll(() => problems.join('\n')).toContain('pageerror: boom');

      // Picture, script and media picture: each is a broken page, not an answer to a question.
      for (const broken of ['/missing-hero.png', '/missing-script.js', '/api/v1/media/ast_']) {
        expect(
          problems.some(
            (problem) => problem.startsWith('console.error:') && problem.includes(broken),
          ),
          `${broken} is reported`,
        ).toBe(true);
      }
      // The signed-out API answers 401 to the fetch: that is expected and silent.
      expect(problems.join('\n')).not.toContain('/api/v1/generations/');

      // A page the context opens later is watched as well (a popup, a second tab).
      const before = problems.length;
      const second = await context.newPage();
      await second.goto('/__probe-second');
      await expect.poll(() => problems.length).toBeGreaterThan(before);
    } finally {
      await context.close();
    }
  });

  test('a test may declare the errors it provokes', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    try {
      const problems: string[] = [];
      createConsoleWatch(problems, [/Failed to load resource/]).context(context);
      await context.route('**/__probe*', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>probe</title><img src="/missing-hero.png" alt=""><script>setTimeout(() => { throw new Error("still reported"); }, 0);</script>',
        }),
      );
      const page = await context.newPage();
      await page.goto('/__probe');
      await expect.poll(() => problems.join('\n')).toContain('pageerror: still reported');
      expect(problems.filter((problem) => problem.includes('missing-hero'))).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

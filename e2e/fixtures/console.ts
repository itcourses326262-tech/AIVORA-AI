import type { BrowserContext, ConsoleMessage, Page, Request } from '@playwright/test';

/**
 * Watching the browser's own complaints. An uncaught exception or a console error on any page is a
 * defect of the product whatever the test was about, EXCEPT the browser reporting that the API
 * refused a request on purpose (401 for a signed-out visitor, 404 for somebody else's creation,
 * 422 for a bad form, ...): tests provoke those all the time, and the browser logs each as
 * "Failed to load resource". That exception is narrow. It covers the API (`/api/`, but not the media
 * route `/api/v1/media/`) and the page's own address (a test that visits a page that does not
 * exist; its own assertions check the status). A picture that does not load is a broken page, not
 * an answer to a question, and so are a missing script, font, stylesheet or icon. A test that
 * provokes anything more lists it in `expectedConsoleErrors`; a pattern is tried against the
 * message and against `message (address)`, so it can name the address.
 */

const REFUSAL_TEXT =
  /^Failed to load resource: the server responded with a status of (?:401|403|404|409|422|429)\b/;

/** A path under `/api/` that is a question the test asked, not part of the page's own content. */
function isApiQuestion(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return path.startsWith('/api/') && !path.startsWith('/api/v1/media/');
}

/**
 * True for the browser's note about a refused request that is the answer a test asked for: an API
 * call the server refused, or one of the pages the browser itself navigated to (`documents`)
 * answering with a refusal, as a missing page does.
 */
export function isExpectedRefusal(
  message: Pick<ConsoleMessage, 'text' | 'location'>,
  documents: ReadonlySet<string>,
): boolean {
  if (!REFUSAL_TEXT.test(message.text())) return false;
  const url = message.location().url;
  return isApiQuestion(url) || documents.has(url);
}

export interface ConsoleWatch {
  /** Reports every uncaught exception and unexpected console error of this page. */
  page(page: Page): void;
  /** The same for every page of the context, including pages it opens later (popups, new tabs). */
  context(context: BrowserContext): void;
}

/**
 * Collects what a page may not do into `problems`. `expected` are the patterns of console errors a
 * test provokes on purpose.
 */
export function createConsoleWatch(
  problems: string[],
  expected: readonly RegExp[] = [],
): ConsoleWatch {
  const watchPage = (page: Page) => {
    // The addresses of the pages this page was sent to: the request is seen before the browser's
    // note about its answer, so a missing page is known to be one by then.
    const documents = new Set<string>();
    page.on('request', (request: Request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        documents.add(request.url());
      }
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (isExpectedRefusal(message, documents)) return;
      const source = message.location().url;
      const described = `${message.text()}${source ? ` (${source})` : ''}`;
      if (expected.some((pattern) => pattern.test(message.text()) || pattern.test(described))) {
        return;
      }
      problems.push(`console.error: ${described}`);
    });
  };
  return {
    page: watchPage,
    context(context) {
      for (const page of context.pages()) watchPage(page);
      context.on('page', watchPage);
    },
  };
}

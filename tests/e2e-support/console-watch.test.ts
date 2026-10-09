import { EventEmitter } from 'node:events';
import type { BrowserContext, ConsoleMessage, Page, Request } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { createConsoleWatch, isExpectedRefusal } from '../../e2e/fixtures/console';

/**
 * The end-to-end console guard decides which browser complaints fail a test. Its exception (the API
 * refusing a request on purpose) must stay narrow, or a broken picture, script or font goes unseen.
 */

function message(text: string, url = '', type = 'error'): ConsoleMessage {
  return {
    type: () => type,
    text: () => text,
    location: () => ({ url, lineNumber: 0, columnNumber: 0 }),
  } as unknown as ConsoleMessage;
}

const refused = (status: number) =>
  `Failed to load resource: the server responded with a status of ${status} (Whatever)`;

const PAGE = 'http://localhost:3200/gallery';
const NO_DOCUMENTS: ReadonlySet<string> = new Set();

describe('isExpectedRefusal', () => {
  it.each([401, 403, 404, 409, 422, 429])('accepts a %i answer from the API', (status) => {
    expect(
      isExpectedRefusal(
        message(refused(status), 'http://localhost:3200/api/v1/models'),
        NO_DOCUMENTS,
      ),
    ).toBe(true);
  });

  it('accepts a page the browser was sent to answering 404 (a test that visits a missing page)', () => {
    const missing = 'http://localhost:3200/s/gen_00000000000000000000000000';
    expect(isExpectedRefusal(message(refused(404), missing), new Set([missing]))).toBe(true);
    expect(isExpectedRefusal(message(refused(404), missing), NO_DOCUMENTS)).toBe(false);
  });

  it('rejects the same answers for pictures, scripts, fonts and icons, also on this origin', () => {
    for (const path of [
      '/hero.png',
      '/_next/static/chunks/app.js',
      '/fonts/inter.woff2',
      '/icon.svg',
    ]) {
      expect(
        isExpectedRefusal(message(refused(404), `http://localhost:3200${path}`), new Set([PAGE])),
        path,
      ).toBe(false);
    }
  });

  it('rejects a picture of the media route that does not load, and other statuses and texts', () => {
    const rejected = (text: string, url: string) =>
      isExpectedRefusal(message(text, url), new Set([PAGE]));
    expect(rejected(refused(404), 'http://localhost:3200/api/v1/media/ast_abc')).toBe(false);
    expect(rejected(refused(500), 'http://localhost:3200/api/v1/models')).toBe(false);
    expect(rejected(refused(400), 'http://localhost:3200/api/v1/models')).toBe(false);
    expect(rejected('Uncaught TypeError: x', 'http://localhost:3200/api/v1/models')).toBe(false);
    expect(rejected(refused(404), '')).toBe(false);
    expect(rejected(refused(404), 'not a url')).toBe(false);
  });
});

const MAIN_FRAME = {};

function fakePage(): Page & EventEmitter {
  return Object.assign(new EventEmitter(), { mainFrame: () => MAIN_FRAME }) as unknown as Page &
    EventEmitter;
}

function navigation(url: string, frame: object = MAIN_FRAME): Request {
  return {
    isNavigationRequest: () => true,
    frame: () => frame,
    url: () => url,
  } as unknown as Request;
}

describe('createConsoleWatch', () => {
  it('collects exceptions and unexpected errors, and ignores warnings and API refusals', () => {
    const problems: string[] = [];
    const page = fakePage();
    createConsoleWatch(problems).page(page);

    page.emit('console', message('just a log', '', 'log'));
    page.emit('console', message('careful', '', 'warning'));
    page.emit('console', message(refused(404), 'http://localhost:3200/api/v1/generations/x'));
    expect(problems).toEqual([]);

    page.emit('console', message(refused(404), 'http://localhost:3200/hero.png'));
    page.emit('pageerror', new Error('boom'));
    expect(problems).toEqual([
      `console.error: ${refused(404)} (http://localhost:3200/hero.png)`,
      'pageerror: boom',
    ]);
  });

  it('lets a page the browser navigated to answer 404, and nothing else on that address', () => {
    const problems: string[] = [];
    const page = fakePage();
    createConsoleWatch(problems).page(page);
    const missing = 'http://localhost:3200/s/gen_00000000000000000000000000';
    page.emit('request', navigation(missing));
    page.emit('console', message(refused(404), missing));
    expect(problems).toEqual([]);

    // A frame inside the page is not a page the browser was sent to.
    const frame = 'http://localhost:3200/embedded';
    page.emit('request', navigation(frame, {}));
    page.emit('console', message(refused(404), frame));
    expect(problems).toEqual([`console.error: ${refused(404)} (${frame})`]);
  });

  it('lets a test declare the errors it provokes, by message or by message and address', () => {
    const problems: string[] = [];
    const page = fakePage();
    createConsoleWatch(problems, [
      /Content Security Policy/,
      /status of 400 .*\/api\/v1\/auth\/password\/reset/,
    ]).page(page);
    page.emit('console', message('Refused by the Content Security Policy directive'));
    page.emit('console', message(refused(400), 'http://localhost:3200/api/v1/auth/password/reset'));
    page.emit('console', message(refused(400), 'http://localhost:3200/api/v1/auth/login'));
    page.emit('console', message('something else'));
    expect(problems).toEqual([
      `console.error: ${refused(400)} (http://localhost:3200/api/v1/auth/login)`,
      'console.error: something else',
    ]);
  });

  it('watches the pages a context already has and the ones it opens later', () => {
    const problems: string[] = [];
    const existing = fakePage();
    const context = Object.assign(new EventEmitter(), {
      pages: () => [existing],
    }) as unknown as BrowserContext & EventEmitter;
    createConsoleWatch(problems).context(context);

    existing.emit('pageerror', new Error('first'));
    const later = fakePage();
    context.emit('page', later);
    later.emit('pageerror', new Error('second'));
    expect(problems).toEqual(['pageerror: first', 'pageerror: second']);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { LEGAL_LAST_UPDATED, LEGAL_PATHS, LEGAL_SLUGS } from '@/lib/legal';
import { resetEnvForTests } from '@/server/env';

afterEach(() => {
  delete process.env.APP_URL;
  resetEnvForTests();
});

describe('sitemap', () => {
  it('lists the four legal pages, with the public origin, besides the pages it had', () => {
    process.env.APP_URL = 'https://aivore.example';
    resetEnvForTests();
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual(
      expect.arrayContaining(['https://aivore.example/', 'https://aivore.example/explore']),
    );
    for (const slug of LEGAL_SLUGS) {
      expect(urls).toContain(`https://aivore.example${LEGAL_PATHS[slug]}`);
    }
    expect(urls).toContain('https://aivore.example/terms');
    expect(urls).toContain('https://aivore.example/privacy');
    expect(urls).toContain('https://aivore.example/refunds');
    expect(urls).toContain('https://aivore.example/acceptable-use');
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('dates each legal page by its last update and treats it as a slow-moving page', () => {
    for (const slug of LEGAL_SLUGS) {
      const entry = sitemap().find((item) => item.url.endsWith(LEGAL_PATHS[slug]));
      expect(entry, slug).toBeDefined();
      expect(entry?.lastModified).toEqual(new Date(`${LEGAL_LAST_UPDATED[slug]}T00:00:00Z`));
      expect(entry?.changeFrequency).toBe('yearly');
      expect(entry?.priority).toBeLessThan(0.8);
    }
  });

  it('leaves the pages behind a login out, and robots lets crawlers read the legal pages', () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const hidden of ['/studio', '/gallery', '/account', '/api']) {
      expect(urls.some((url) => url.includes(hidden))).toBe(false);
    }
    const rule = [robots().rules].flat()[0];
    const disallow = ([] as string[]).concat(rule?.disallow ?? []);
    for (const slug of LEGAL_SLUGS) {
      expect(disallow.some((prefix) => LEGAL_PATHS[slug].startsWith(prefix))).toBe(false);
    }
  });
});

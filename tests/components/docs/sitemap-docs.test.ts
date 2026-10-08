import { afterEach, describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { resetEnvForTests } from '@/server/env';

afterEach(() => {
  delete process.env.APP_URL;
  resetEnvForTests();
});

describe('the public documentation in the sitemap', () => {
  it('is listed once, under the public origin', () => {
    process.env.APP_URL = 'https://aivore.example';
    resetEnvForTests();
    const entries = sitemap().filter((entry) => entry.url === 'https://aivore.example/docs');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.changeFrequency).toBe('monthly');
  });

  it('may be read by crawlers, unlike the account area next to it', () => {
    const rule = [robots().rules].flat()[0];
    const disallow = ([] as string[]).concat(rule?.disallow ?? []);
    expect(disallow.some((prefix) => '/docs'.startsWith(prefix))).toBe(false);
    expect(disallow).toContain('/account');
  });
});

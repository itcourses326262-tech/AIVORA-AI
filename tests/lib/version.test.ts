import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '@/lib/version';
import packageJson from '../../package.json';

describe('APP_VERSION', () => {
  it('is the version in package.json', () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

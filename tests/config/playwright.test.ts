import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvConfig } from '@next/env';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '@/server/env';
import { ISOLATED_ENV_KEYS } from '../helpers/isolated-env';

const scratch = mkdtempSync(join(tmpdir(), 'aivore-pwconfig-'));
let webServerEnv: Record<string, string>;

beforeAll(async () => {
  // The config creates (and removes at exit) its own scratch dir unless one is provided.
  vi.stubEnv('AIVORA_E2E_DIR', join(scratch, 'e2e'));
  const { default: config } = await import('../../playwright.config');
  const webServer = config.webServer;
  if (!webServer || Array.isArray(webServer) || !webServer.env) {
    throw new Error('playwright.config.ts must define a single webServer with an env');
  }
  webServerEnv = webServer.env;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('e2e web server environment', () => {
  it('blanks every provider key, S3 setting and privilege list a developer might have set', () => {
    for (const key of ISOLATED_ENV_KEYS) {
      expect(webServerEnv, key).toHaveProperty(key, '');
    }
  });

  it('pins moderation and the prompt enhancer to offline implementations', () => {
    expect(webServerEnv).toMatchObject({
      MODERATION_PROVIDER: 'none',
      PROMPT_ENHANCER: 'heuristic',
      TRUST_PROXY: 'false',
      ENABLE_MOCK_PROVIDER: 'true',
    });
  });

  it('keeps developer secrets out even when .env.local defines them (Next loads it in production)', () => {
    const dir = join(scratch, 'project');
    mkdirSync(dir);
    writeFileSync(
      join(dir, '.env.local'),
      [
        ...ISOLATED_ENV_KEYS.map((key) => `${key}=leaked-${key}`),
        'MODERATION_PROVIDER=openai',
        'PROMPT_ENHANCER=openai',
      ].join('\n'),
    );

    // `next start` receives webServer.env on top of the parent environment, then loads dotenv files.
    const touched = [...Object.keys(webServerEnv), 'MODERATION_PROVIDER', 'PROMPT_ENHANCER'];
    const saved = new Map(touched.map((key) => [key, process.env[key]]));
    for (const key of touched) delete process.env[key];
    try {
      Object.assign(process.env, webServerEnv);
      loadEnvConfig(dir, false, { info: () => {}, error: () => {} }, true);

      for (const key of ISOLATED_ENV_KEYS) expect(process.env[key], key).toBe('');
      expect(process.env.MODERATION_PROVIDER).toBe('none');
      expect(process.env.PROMPT_ENHANCER).toBe('heuristic');

      // And the application sees no provider, no admin, no S3 and a valid configuration.
      const env = parseEnv(process.env);
      expect(env).toMatchObject({
        OPENAI_API_KEY: undefined,
        FAL_KEY: undefined,
        REPLICATE_API_TOKEN: undefined,
        ANTHROPIC_API_KEY: undefined,
        S3_BUCKET: undefined,
        ADMIN_EMAILS: [],
        MODERATION_BLOCKLIST: [],
        MODERATION_PROVIDER: 'none',
        PROMPT_ENHANCER: 'heuristic',
      });
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      for (const key of ISOLATED_ENV_KEYS) delete process.env[key];
    }
  });
});

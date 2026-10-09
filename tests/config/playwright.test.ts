import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvConfig, updateInitialEnv } from '@next/env';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '@/server/env';
import { ISOLATED_ENV_KEYS } from '../helpers/isolated-env';

const scratch = mkdtempSync(join(tmpdir(), 'aivore-pwconfig-'));
const servers = new Map<string, Record<string, string>>();

/**
 * The mail relay is the one thing the second application (`app-smtp`) is meant to reach: it is
 * what switches e-mail confirmation on. Everything else that could reach a real service is blank in
 * both.
 */
const RELAY_KEYS: ReadonlySet<string> = new Set(['SMTP_URL', 'EMAIL_FROM', 'EMAIL_VERIFICATION']);

beforeAll(async () => {
  // The config creates (and removes at exit) its own scratch dir unless one is provided.
  vi.stubEnv('AIVORE_E2E_DIR', join(scratch, 'e2e'));
  const { default: config } = await import('../../playwright.config');
  const webServers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
  for (const webServer of webServers) {
    if (webServer?.name && webServer.env) servers.set(webServer.name, webServer.env);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe.each(['app', 'app-smtp'])('e2e web server environment: %s', (name) => {
  const serverEnv = (): Record<string, string> => {
    const env = servers.get(name);
    if (!env)
      throw new Error(`playwright.config.ts must define a web server "${name}" with an env`);
    return env;
  };

  it('blanks every provider key, S3 setting and privilege list a developer might have set', () => {
    for (const key of ISOLATED_ENV_KEYS) {
      if (name === 'app-smtp' && RELAY_KEYS.has(key)) continue;
      expect(serverEnv(), key).toHaveProperty(key, '');
    }
  });

  it('pins moderation and the prompt enhancer to offline implementations', () => {
    expect(serverEnv()).toMatchObject({
      MODERATION_PROVIDER: 'none',
      PROMPT_ENHANCER: 'heuristic',
      TRUST_PROXY: 'false',
      ENABLE_MOCK_PROVIDER: 'true',
    });
  });

  it('keeps developer secrets out even when .env.local defines them (Next loads it in production)', () => {
    const dir = join(scratch, `project-${name}`);
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
    const webServerEnv = serverEnv();
    const touched = [...Object.keys(webServerEnv), 'MODERATION_PROVIDER', 'PROMPT_ENHANCER'];
    const saved = new Map(touched.map((key) => [key, process.env[key]]));
    for (const key of touched) delete process.env[key];
    try {
      Object.assign(process.env, webServerEnv);
      // Next remembers the environment of its first call as "the process's own": this process is
      // being started with the environment of each server in turn.
      updateInitialEnv(webServerEnv);
      loadEnvConfig(dir, false, { info: () => {}, error: () => {} }, true);

      // Whatever the server was started with (blank, or the relay of app-smtp) is what it keeps.
      for (const key of ISOLATED_ENV_KEYS) expect(process.env[key], key).toBe(webServerEnv[key]);
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

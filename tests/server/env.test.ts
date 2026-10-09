import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEV_SESSION_SECRET,
  EnvError,
  getEnv,
  parseEnv,
  resetEnvForTests,
  type Env,
} from '@/server/env';
import { resetLoggerForTests } from '@/server/logger';

const GOOD_SECRET = 'x'.repeat(40);

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  return [];
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  resetLoggerForTests();
});

describe('parseEnv defaults', () => {
  it('needs nothing in development and applies every documented default', () => {
    const env = parseEnv({});
    expect(env).toEqual({
      NODE_ENV: 'development',
      APP_URL: 'http://localhost:3000',
      DATABASE_PATH: './data/aivore.db',
      SESSION_SECRET: DEV_SESSION_SECRET,
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: './data/media',
      S3_ENDPOINT: undefined,
      S3_REGION: 'auto',
      S3_BUCKET: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
      S3_FORCE_PATH_STYLE: false,
      S3_SIGNED_URL_TTL_SEC: 900,
      FIREBASE_API_KEY: undefined,
      FIREBASE_AUTH_DOMAIN: undefined,
      FIREBASE_PROJECT_ID: undefined,
      FIREBASE_APP_ID: undefined,
      FIREBASE_AUTH: 'auto',
      FIREBASE_STORAGE_BUCKET: undefined,
      FIREBASE_SERVICE_ACCOUNT_FILE: undefined,
      FIREBASE_SERVICE_ACCOUNT_JSON: undefined,
      ENABLE_MOCK_PROVIDER: true,
      OPENAI_API_KEY: undefined,
      FAL_KEY: undefined,
      REPLICATE_API_TOKEN: undefined,
      ANTHROPIC_API_KEY: undefined,
      PROMPT_ENHANCER: 'auto',
      PROMPT_ENHANCER_OPENAI_MODEL: 'gpt-4.1-mini',
      PROMPT_ENHANCER_ANTHROPIC_MODEL: 'claude-haiku-5-5',
      SIGNUP_ENABLED: true,
      SIGNUP_BONUS_CREDITS: 50,
      ADMIN_EMAILS: [],
      WORKER_MODE: 'inline',
      WORKER_CONCURRENCY: 2,
      MAX_ACTIVE_PER_USER: 4,
      MAX_ATTEMPTS: 3,
      GENERATION_TIMEOUT_SEC_IMAGE: 180,
      GENERATION_TIMEOUT_SEC_VIDEO: 900,
      MAX_UPLOAD_MB: 10,
      MODERATION_BLOCKLIST: [],
      MODERATION_PROVIDER: 'none',
      LOG_LEVEL: 'info',
      TRUST_PROXY: false,
      TRUSTED_PROXY_HOPS: 1,
      RATE_LIMIT_DISABLED: false,
      DAILY_UPSTREAM_BUDGET_CREDITS: 0,
      SMTP_URL: undefined,
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
      SMTP_USER: undefined,
      SMTP_PASS: undefined,
      SMTP_SECURE: false,
      EMAIL_FROM: undefined,
      EMAIL_VERIFICATION: 'auto',
      DISPOSABLE_EMAIL_DOMAINS: [],
      SIGNUPS_PER_IP_PER_DAY: 5,
      BILLING_GATEWAY: 'auto',
      MOYASAR_SECRET_KEY: undefined,
      MOYASAR_PUBLISHABLE_KEY: undefined,
      MOYASAR_WEBHOOK_SECRET: undefined,
      MOYASAR_API_BASE: 'https://api.moyasar.com/v1',
      MOYASAR_ALLOW_LIVE_IN_DEV: false,
      MOYASAR_ALLOW_TEST_IN_PRODUCTION: false,
      VAT_RATE_PERCENT: 15,
    });
  });

  it('DAILY_UPSTREAM_BUDGET_CREDITS: 0 (the default) disables the guard, anything else is a whole number', () => {
    expect(parseEnv({}).DAILY_UPSTREAM_BUDGET_CREDITS).toBe(0);
    expect(parseEnv({ DAILY_UPSTREAM_BUDGET_CREDITS: '' }).DAILY_UPSTREAM_BUDGET_CREDITS).toBe(0);
    expect(parseEnv({ DAILY_UPSTREAM_BUDGET_CREDITS: '5000' }).DAILY_UPSTREAM_BUDGET_CREDITS).toBe(
      5000,
    );
    for (const bad of ['-1', '12.5', 'lots', '1000000001']) {
      expect(() => parseEnv({ DAILY_UPSTREAM_BUDGET_CREDITS: bad }), bad).toThrow(
        /DAILY_UPSTREAM_BUDGET_CREDITS/,
      );
    }
  });

  it('treats blank values as unset, as .env.example ships them', () => {
    const env = parseEnv({
      APP_URL: '',
      DATABASE_PATH: '  ',
      S3_BUCKET: '',
      OPENAI_API_KEY: '',
      WORKER_CONCURRENCY: '',
      SIGNUP_ENABLED: '',
      ADMIN_EMAILS: '',
      SESSION_SECRET: '',
    });
    expect(env.APP_URL).toBe('http://localhost:3000');
    expect(env.DATABASE_PATH).toBe('./data/aivore.db');
    expect(env.S3_BUCKET).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.WORKER_CONCURRENCY).toBe(2);
    expect(env.SIGNUP_ENABLED).toBe(true);
    expect(env.ADMIN_EMAILS).toEqual([]);
    expect(env.SESSION_SECRET).toBe(DEV_SESSION_SECRET);
  });

  it('accepts the bundled .env.example values', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
    const source: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match?.[1]) source[match[1]] = match[2] ?? '';
    }
    expect(Object.keys(source).length).toBeGreaterThan(30);
    expect(() => parseEnv(source)).not.toThrow();
  });
});

describe('coercion', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['on', true],
    ['false', false],
    ['False', false],
    ['0', false],
    ['no', false],
    ['off', false],
  ])('parses boolean %s', (raw, expected) => {
    expect(parseEnv({ SIGNUP_ENABLED: raw, ENABLE_MOCK_PROVIDER: raw }).SIGNUP_ENABLED).toBe(
      expected,
    );
    expect(parseEnv({ ENABLE_MOCK_PROVIDER: raw }).ENABLE_MOCK_PROVIDER).toBe(expected);
  });

  it('rejects a boolean it cannot read and names the variable', () => {
    expect(problemsOf({ SIGNUP_ENABLED: 'maybe' }).join('\n')).toMatch(/^SIGNUP_ENABLED:/m);
  });

  it('parses numbers and trims whitespace', () => {
    const env = parseEnv({
      WORKER_CONCURRENCY: ' 8 ',
      SIGNUP_BONUS_CREDITS: '0',
      MAX_UPLOAD_MB: '25',
    });
    expect(env.WORKER_CONCURRENCY).toBe(8);
    expect(env.SIGNUP_BONUS_CREDITS).toBe(0);
    expect(env.MAX_UPLOAD_MB).toBe(25);
  });

  it.each([
    ['WORKER_CONCURRENCY', 'many'],
    ['WORKER_CONCURRENCY', '2.5'],
    ['WORKER_CONCURRENCY', '0'],
    ['WORKER_CONCURRENCY', '999'],
    ['SIGNUP_BONUS_CREDITS', '-1'],
    ['MAX_ATTEMPTS', '0'],
    ['GENERATION_TIMEOUT_SEC_IMAGE', '1'],
    ['S3_SIGNED_URL_TTL_SEC', '10'],
  ])('rejects %s=%s', (name, value) => {
    expect(problemsOf({ [name]: value }).join('\n')).toContain(`${name}:`);
  });

  it('rejects unknown enum values with the variable name', () => {
    expect(problemsOf({ WORKER_MODE: 'cloud' }).join('\n')).toContain('WORKER_MODE:');
    expect(problemsOf({ STORAGE_DRIVER: 'ftp' }).join('\n')).toContain('STORAGE_DRIVER:');
    expect(problemsOf({ LOG_LEVEL: 'loud' }).join('\n')).toContain('LOG_LEVEL:');
    expect(parseEnv({ LOG_LEVEL: 'silent' }).LOG_LEVEL).toBe('silent');
  });

  it('normalizes comma lists', () => {
    const env = parseEnv({
      ADMIN_EMAILS: ' Admin@Example.com, ops@example.com ,,',
      MODERATION_BLOCKLIST: 'Foo, bar ',
    });
    expect(env.ADMIN_EMAILS).toEqual(['admin@example.com', 'ops@example.com']);
    expect(env.MODERATION_BLOCKLIST).toEqual(['Foo', 'bar']);
  });

  it('normalizes APP_URL and requires http(s)', () => {
    expect(parseEnv({ APP_URL: 'https://aivore.example.com///' }).APP_URL).toBe(
      'https://aivore.example.com',
    );
    expect(problemsOf({ APP_URL: 'aivore.example.com' }).join('\n')).toContain('APP_URL:');
    expect(problemsOf({ APP_URL: 'ftp://aivore.example.com' }).join('\n')).toContain('APP_URL:');
  });
});

describe('SESSION_SECRET', () => {
  it('is required in production, with a helpful message', () => {
    const problems = problemsOf({ NODE_ENV: 'production' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^SESSION_SECRET: is required in production/);
    expect(problems[0]).toContain('openssl rand -hex 32');
  });

  it('must be at least 32 characters whenever it is provided', () => {
    expect(problemsOf({ NODE_ENV: 'production', SESSION_SECRET: 'short' })[0]).toMatch(
      /at least 32 characters/,
    );
    expect(problemsOf({ NODE_ENV: 'development', SESSION_SECRET: 'x'.repeat(31) })[0]).toMatch(
      /at least 32 characters/,
    );
    expect(
      parseEnv({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) }).SESSION_SECRET,
    ).toBe('x'.repeat(32));
  });

  it('refuses the built-in development secret in production', () => {
    expect(
      problemsOf({ NODE_ENV: 'production', SESSION_SECRET: DEV_SESSION_SECRET }).join('\n'),
    ).toMatch(/built-in development secret/);
  });

  it('falls back to the development default outside production', () => {
    expect(parseEnv({ NODE_ENV: 'development' }).SESSION_SECRET).toBe(DEV_SESSION_SECRET);
    expect(parseEnv({ NODE_ENV: 'test' }).SESSION_SECRET).toBe(DEV_SESSION_SECRET);
  });

  it('the development default is itself long enough to pass the length rule', () => {
    expect(DEV_SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});

describe('cross-field checks', () => {
  it('requires S3 credentials when STORAGE_DRIVER=s3', () => {
    const problems = problemsOf({ STORAGE_DRIVER: 's3' }).join('\n');
    expect(problems).toContain('S3_BUCKET: is required when STORAGE_DRIVER=s3');
    expect(problems).toContain('S3_ACCESS_KEY_ID');
    expect(problems).toContain('S3_SECRET_ACCESS_KEY');
    expect(
      problemsOf({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 's',
      }),
    ).toEqual([]);
  });

  it('requires the matching key for an explicit prompt enhancer or moderation provider', () => {
    expect(problemsOf({ PROMPT_ENHANCER: 'openai' }).join('\n')).toContain('OPENAI_API_KEY');
    expect(problemsOf({ PROMPT_ENHANCER: 'anthropic' }).join('\n')).toContain('ANTHROPIC_API_KEY');
    expect(problemsOf({ MODERATION_PROVIDER: 'openai' }).join('\n')).toContain('OPENAI_API_KEY');
    expect(problemsOf({ PROMPT_ENHANCER: 'openai', OPENAI_API_KEY: 'sk-test' })).toEqual([]);
    expect(problemsOf({ PROMPT_ENHANCER: 'heuristic' })).toEqual([]);
  });

  it('reports every problem at once', () => {
    const error = (() => {
      try {
        parseEnv({ NODE_ENV: 'production', WORKER_CONCURRENCY: 'x', STORAGE_DRIVER: 's3' });
      } catch (caught) {
        return caught as EnvError;
      }
      throw new Error('expected parseEnv to throw');
    })();
    expect(error).toBeInstanceOf(EnvError);
    expect(error.problems.length).toBeGreaterThanOrEqual(5);
    expect(error.message).toMatch(/^Invalid environment configuration:\n/);
    expect(error.message).toContain('  - WORKER_CONCURRENCY:');
    expect(error.message).toContain('See .env.example');
  });
});

describe('FIREBASE_STORAGE_BUCKET', () => {
  const bucketOf = (value: string | undefined) =>
    parseEnv({ FIREBASE_STORAGE_BUCKET: value }).FIREBASE_STORAGE_BUCKET;

  // The console shows the bucket as gs://name; the driver id and every consumer must see one value.
  it.each([
    ['my-project.firebasestorage.app', 'my-project.firebasestorage.app'],
    ['gs://my-project.firebasestorage.app', 'my-project.firebasestorage.app'],
    ['gs://my-project.firebasestorage.app/', 'my-project.firebasestorage.app'],
    ['GS://my-project.firebasestorage.app//', 'my-project.firebasestorage.app'],
    ['  my-project.firebasestorage.app/  ', 'my-project.firebasestorage.app'],
  ])('reads %j as the bare name', (typed, bare) => {
    expect(bucketOf(typed)).toBe(bare);
  });

  it('counts a value that is nothing but the prefix as unset', () => {
    expect(bucketOf('gs://')).toBeUndefined();
    expect(bucketOf('   ')).toBeUndefined();
    expect(bucketOf(undefined)).toBeUndefined();
  });

  it('is documented in .env.example in the form the console shows it', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
    const comment = text.slice(0, text.indexOf('\nFIREBASE_STORAGE_BUCKET='));
    expect(comment.split('\n').slice(-3).join('\n')).toContain('gs://');
  });

  it('still requires a bucket when STORAGE_DRIVER=gcs', () => {
    const problems = problemsOf({ STORAGE_DRIVER: 'gcs' }).join('\n');
    expect(problems).toContain('FIREBASE_STORAGE_BUCKET: is required when STORAGE_DRIVER=gcs');
  });
});

describe('getEnv', () => {
  it('parses lazily and memoizes', () => {
    vi.stubEnv('WORKER_CONCURRENCY', '5');
    const first = getEnv();
    expect(first.WORKER_CONCURRENCY).toBe(5);
    vi.stubEnv('WORKER_CONCURRENCY', '7');
    expect(getEnv()).toBe(first);
    expect(getEnv().WORKER_CONCURRENCY).toBe(5);
  });

  it('re-reads process.env after resetEnvForTests', () => {
    vi.stubEnv('MAX_UPLOAD_MB', '12');
    expect(getEnv().MAX_UPLOAD_MB).toBe(12);
    vi.stubEnv('MAX_UPLOAD_MB', '13');
    resetEnvForTests();
    expect(getEnv().MAX_UPLOAD_MB).toBe(13);
  });

  it('does not parse at import time, so a broken environment cannot break `next build`', async () => {
    vi.stubEnv('WORKER_CONCURRENCY', 'not-a-number');
    vi.resetModules();
    const fresh = await import('@/server/env');
    expect(() => fresh.getEnv()).toThrow(fresh.EnvError);
  });

  it('does not memoize a failure', async () => {
    vi.stubEnv('WORKER_CONCURRENCY', 'x');
    expect(() => getEnv()).toThrow(EnvError);
    vi.stubEnv('WORKER_CONCURRENCY', '3');
    expect(getEnv().WORKER_CONCURRENCY).toBe(3);
  });

  it('warns once that the insecure development secret is in use', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SESSION_SECRET', '');
    vi.stubEnv('LOG_LEVEL', 'warn');
    resetLoggerForTests();
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    getEnv();
    getEnv();
    const lines = write.mock.calls.map(([chunk]) => String(chunk));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'warn',
      msg: expect.stringContaining('SESSION_SECRET is not set'),
    });
  });

  it('stays quiet when a real secret is configured', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SESSION_SECRET', GOOD_SECRET);
    vi.stubEnv('LOG_LEVEL', 'debug');
    resetLoggerForTests();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(getEnv().SESSION_SECRET).toBe(GOOD_SECRET);
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });
});

// `next dev` reloads .env.local into process.env while the site runs; `npm run setup:fal` relies on
// getEnv() noticing, so a provider key takes effect without a restart. Only in development.
describe('getEnv hot reload', () => {
  // Built at runtime: key-shaped literals are rejected by tests/security/no-secret-literals.test.ts.
  const FAKE_KEY = 'k'.repeat(30);

  /** Starts capturing what the logger writes to stderr; call the result for the lines so far. */
  function captureStderr(): () => string[] {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    return () => write.mock.calls.map(([chunk]) => String(chunk));
  }

  describe('in development', () => {
    it.each<[string, string, (env: Env) => unknown, unknown]>([
      ['FAL_KEY', FAKE_KEY, (env) => env.FAL_KEY, FAKE_KEY],
      ['OPENAI_API_KEY', FAKE_KEY, (env) => env.OPENAI_API_KEY, FAKE_KEY],
      ['REPLICATE_API_TOKEN', FAKE_KEY, (env) => env.REPLICATE_API_TOKEN, FAKE_KEY],
      ['ENABLE_MOCK_PROVIDER', 'false', (env) => env.ENABLE_MOCK_PROVIDER, false],
      ['DAILY_UPSTREAM_BUDGET_CREDITS', '500', (env) => env.DAILY_UPSTREAM_BUDGET_CREDITS, 500],
    ])('sees %s changed after the first read', (name, value, read, expected) => {
      vi.stubEnv('NODE_ENV', 'development');
      const first = getEnv();
      expect(read(first)).not.toBe(expected);
      vi.stubEnv(name, value);
      const second = getEnv();
      expect(second).not.toBe(first);
      expect(read(second)).toBe(expected);
    });

    it('sees a provider key added after the first read, and then keeps it', () => {
      vi.stubEnv('NODE_ENV', 'development');
      expect(getEnv().FAL_KEY).toBeUndefined();
      vi.stubEnv('FAL_KEY', FAKE_KEY);
      const withKey = getEnv();
      expect(withKey.FAL_KEY).toBe(FAKE_KEY);
      expect(getEnv()).toBe(withKey);
    });

    it('sees a provider key removed again', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('FAL_KEY', FAKE_KEY);
      expect(getEnv().FAL_KEY).toBe(FAKE_KEY);
      vi.stubEnv('FAL_KEY', '');
      expect(getEnv().FAL_KEY).toBeUndefined();
    });

    it('returns the very same object while the settings are unchanged', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('FAL_KEY', FAKE_KEY);
      const first = getEnv();
      expect(getEnv()).toBe(first);
      expect(getEnv()).toBe(first);
    });

    it('does not parse again for a blank value that was already unset', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const first = getEnv();
      vi.stubEnv('FAL_KEY', '');
      expect(getEnv()).toBe(first);
    });

    it('leaves every other setting alone: only the provider and spend settings are re-read', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('WORKER_CONCURRENCY', '5');
      const first = getEnv();
      vi.stubEnv('WORKER_CONCURRENCY', '7');
      expect(getEnv()).toBe(first);
      expect(getEnv().WORKER_CONCURRENCY).toBe(5);
    });

    it('applies only the provider and spend settings when one of them changes with others pending', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('WORKER_CONCURRENCY', '5');
      getEnv();
      vi.stubEnv('WORKER_CONCURRENCY', '7');
      vi.stubEnv('FAL_KEY', FAKE_KEY);
      const next = getEnv();
      expect(next.FAL_KEY).toBe(FAKE_KEY);
      // The unrelated edit waits for a restart, so the job runner never works from two snapshots.
      expect(next.WORKER_CONCURRENCY).toBe(5);
    });

    it('is one environment for every copy of the module the dev server evaluates', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', '100');
      const stderr = captureStderr();
      const warnings = () => stderr().filter((line) => line.includes('SESSION_SECRET')).length;
      const first = getEnv();
      const warnedAtStart = warnings();

      // The dev server evaluates the module again after a .env.local change (another module graph).
      vi.resetModules();
      const copy = await import('@/server/env');
      expect(copy.getEnv()).toBe(first);

      // A half-typed edit reaches the other copy too: it keeps what is in use instead of throwing.
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', 'lots');
      expect(() => copy.getEnv()).not.toThrow();
      expect(copy.getEnv().DAILY_UPSTREAM_BUDGET_CREDITS).toBe(100);
      expect(getEnv().DAILY_UPSTREAM_BUDGET_CREDITS).toBe(100);
      // The start-up warning was said once, not once per module copy.
      expect(warnings()).toBe(warnedAtStart);
    });

    it('keeps the previous settings when a changed value no longer parses, and does not throw', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', '100');
      const good = getEnv();
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', 'lots');
      // The broken edit comes with a valid one; the whole environment is kept, not half of it.
      vi.stubEnv('FAL_KEY', FAKE_KEY);
      expect(() => getEnv()).not.toThrow();
      expect(getEnv()).toBe(good);
      expect(getEnv().DAILY_UPSTREAM_BUDGET_CREDITS).toBe(100);
      expect(getEnv().FAL_KEY).toBeUndefined();
    });

    it('picks the settings up once the value is fixed', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', '100');
      const good = getEnv();
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', 'lots');
      vi.stubEnv('FAL_KEY', FAKE_KEY);
      expect(getEnv()).toBe(good);
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', '200');
      const fixed = getEnv();
      expect(fixed).not.toBe(good);
      expect(fixed).toMatchObject({ DAILY_UPSTREAM_BUDGET_CREDITS: 200, FAL_KEY: FAKE_KEY });
    });

    it('also recovers when the broken value is put back to what it was', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', '100');
      const good = getEnv();
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', 'lots');
      expect(getEnv()).toBe(good);
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', '100');
      expect(getEnv().DAILY_UPSTREAM_BUDGET_CREDITS).toBe(100);
    });

    it('still throws when the very first read is invalid: there is nothing to keep', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', 'lots');
      expect(() => getEnv()).toThrow(EnvError);
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', '5');
      expect(getEnv().DAILY_UPSTREAM_BUDGET_CREDITS).toBe(5);
    });

    it('says once that a changed value does not parse, naming the setting', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('LOG_LEVEL', 'warn');
      resetLoggerForTests();
      const written = captureStderr();
      getEnv();
      vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', 'lots');
      vi.stubEnv('FAL_KEY', FAKE_KEY);
      getEnv();
      getEnv();
      const lines = written();
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0] ?? '') as {
        level: string;
        msg: string;
        problems: string[];
      };
      expect(entry).toMatchObject({
        level: 'warn',
        msg: expect.stringContaining('does not parse'),
      });
      expect(entry.problems.join('\n')).toContain('DAILY_UPSTREAM_BUDGET_CREDITS');
      expect(lines.join('\n')).not.toContain(FAKE_KEY);
    });

    it('does not repeat the start-up warnings when it reloads', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('SESSION_SECRET', '');
      vi.stubEnv('LOG_LEVEL', 'warn');
      resetLoggerForTests();
      const written = captureStderr();
      getEnv();
      expect(written()).toHaveLength(1);
      vi.stubEnv('FAL_KEY', FAKE_KEY);
      expect(getEnv().FAL_KEY).toBe(FAKE_KEY);
      vi.stubEnv('FAL_KEY', `${FAKE_KEY}2`);
      expect(getEnv().FAL_KEY).toBe(`${FAKE_KEY}2`);
      expect(written()).toHaveLength(1);
      expect(written()[0]).toContain('SESSION_SECRET is not set');
    });

    it('logs each reload with which providers are configured, never the key itself', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('LOG_LEVEL', 'info');
      resetLoggerForTests();
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      getEnv();
      expect(stdout).not.toHaveBeenCalled();
      vi.stubEnv('FAL_KEY', FAKE_KEY);
      getEnv();
      getEnv();
      const lines = stdout.mock.calls.map(([chunk]) => String(chunk));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? '')).toMatchObject({
        level: 'info',
        msg: expect.stringContaining('Reloaded provider settings'),
        fal: true,
        openai: false,
        replicate: false,
      });
      expect(
        [...lines, ...stderr.mock.calls.map(([chunk]) => String(chunk))].join('\n'),
      ).not.toContain(FAKE_KEY);
    });
  });

  describe('outside development', () => {
    it.each(['test', 'production'])(
      'keeps the first settings for the life of the process in %s',
      (mode) => {
        vi.stubEnv('NODE_ENV', mode);
        vi.stubEnv('LOG_LEVEL', 'silent');
        vi.stubEnv('SESSION_SECRET', GOOD_SECRET);
        const first = getEnv();
        expect(first.NODE_ENV).toBe(mode);
        expect(first.FAL_KEY).toBeUndefined();
        vi.stubEnv('FAL_KEY', FAKE_KEY);
        vi.stubEnv('ENABLE_MOCK_PROVIDER', 'false');
        vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', '900');
        expect(getEnv()).toBe(first);
        expect(getEnv().FAL_KEY).toBeUndefined();
        expect(getEnv().DAILY_UPSTREAM_BUDGET_CREDITS).toBe(0);
      },
    );

    it('still re-reads after resetEnvForTests', () => {
      vi.stubEnv('NODE_ENV', 'test');
      getEnv();
      vi.stubEnv('FAL_KEY', FAKE_KEY);
      resetEnvForTests();
      expect(getEnv().FAL_KEY).toBe(FAKE_KEY);
    });
  });
});

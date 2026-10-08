import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEV_SESSION_SECRET, EnvError, getEnv, parseEnv, resetEnvForTests } from '@/server/env';
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
    });
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

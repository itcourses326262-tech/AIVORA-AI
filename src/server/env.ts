import 'server-only';
import { z } from 'zod';
import { LOG_LEVELS, getLogger } from './logger';

/**
 * Typed, validated configuration. Parsed lazily on first `getEnv()` (never at import time, so
 * `next build` works without any variables) and memoized. Every variable is documented in
 * `.env.example`; empty values (`KEY=`) count as unset.
 */

export const MIN_SESSION_SECRET_CHARS = 32;
/** Used only outside production when SESSION_SECRET is unset. Never accepted in production. */
export const DEV_SESSION_SECRET = 'aivore-insecure-development-secret-do-not-use-in-production';

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const text = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema);
const flag = (fallback: boolean) =>
  text(z.stringbool({ error: 'must be true or false' }).default(fallback));
const whole = (fallback: number, min: number, max: number) => {
  const error = `must be a whole number between ${min} and ${max}`;
  return text(
    z.coerce
      .number({ error })
      .int({ error })
      .min(min, { error })
      .max(max, { error })
      .default(fallback),
  );
};
const choice = <const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  text(z.enum(values, { error: `must be one of: ${values.join(', ')}` }).default(fallback));
const list = text(
  z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
);
const lowerList = list.transform((items) => items.map((item) => item.toLowerCase()));

const baseUrl = text(
  z
    .url({
      protocol: /^https?$/,
      error: 'must be an http(s) URL such as https://aivore.example.com',
    })
    .default('http://localhost:3000')
    .transform((value) => value.replace(/\/+$/, '')),
);

const envSchema = z
  .object({
    NODE_ENV: choice(['development', 'production', 'test'], 'development'),
    APP_URL: baseUrl,
    DATABASE_PATH: text(z.string().default('./data/aivore.db')),
    SESSION_SECRET: text(z.string().optional()),
    STORAGE_DRIVER: choice(['local', 's3'], 'local'),
    STORAGE_LOCAL_DIR: text(z.string().default('./data/media')),
    S3_ENDPOINT: text(z.url({ error: 'must be a URL such as https://s3.example.com' }).optional()),
    S3_REGION: text(z.string().default('auto')),
    S3_BUCKET: text(z.string().optional()),
    S3_ACCESS_KEY_ID: text(z.string().optional()),
    S3_SECRET_ACCESS_KEY: text(z.string().optional()),
    S3_FORCE_PATH_STYLE: flag(false),
    S3_SIGNED_URL_TTL_SEC: whole(900, 60, 604_800),
    ENABLE_MOCK_PROVIDER: flag(true),
    OPENAI_API_KEY: text(z.string().optional()),
    FAL_KEY: text(z.string().optional()),
    REPLICATE_API_TOKEN: text(z.string().optional()),
    ANTHROPIC_API_KEY: text(z.string().optional()),
    PROMPT_ENHANCER: choice(['auto', 'openai', 'anthropic', 'heuristic'], 'auto'),
    PROMPT_ENHANCER_OPENAI_MODEL: text(z.string().default('gpt-4.1-mini')),
    PROMPT_ENHANCER_ANTHROPIC_MODEL: text(z.string().default('claude-haiku-5-5')),
    SIGNUP_ENABLED: flag(true),
    SIGNUP_BONUS_CREDITS: whole(50, 0, 1_000_000),
    ADMIN_EMAILS: lowerList,
    WORKER_MODE: choice(['inline', 'external', 'off'], 'inline'),
    WORKER_CONCURRENCY: whole(2, 1, 32),
    MAX_ACTIVE_PER_USER: whole(4, 1, 100),
    MAX_ATTEMPTS: whole(3, 1, 10),
    GENERATION_TIMEOUT_SEC_IMAGE: whole(180, 10, 3600),
    GENERATION_TIMEOUT_SEC_VIDEO: whole(900, 30, 7200),
    MAX_UPLOAD_MB: whole(10, 1, 100),
    MODERATION_BLOCKLIST: list,
    MODERATION_PROVIDER: choice(['none', 'openai'], 'none'),
    LOG_LEVEL: choice(LOG_LEVELS, 'info'),
    /** Trust `X-Forwarded-For` for client IPs. Enable only behind a proxy you control. */
    TRUST_PROXY: flag(false),
  })
  .transform((env) => ({
    ...env,
    // Past validation the secret is always usable: required in production, defaulted elsewhere.
    SESSION_SECRET: env.SESSION_SECRET ?? DEV_SESSION_SECRET,
  }));

export type Env = z.output<typeof envSchema>;

export class EnvError extends Error {
  override readonly name = 'EnvError';

  constructor(readonly problems: string[]) {
    super(
      [
        'Invalid environment configuration:',
        ...problems.map((problem) => `  - ${problem}`),
        'See .env.example for every supported variable.',
      ].join('\n'),
    );
  }
}

const present = (source: Readonly<Record<string, string | undefined>>, name: string) => {
  const value = source[name];
  return value === undefined || value.trim() === '' ? undefined : value;
};

/**
 * Rules that relate several variables. They read the raw source (not the parsed object) so they
 * still run, and are reported together with field errors, when some other variable is malformed.
 */
function crossFieldProblems(source: Readonly<Record<string, string | undefined>>): string[] {
  const problems: string[] = [];
  const get = (name: string) => present(source, name);
  const need = (name: string, reason: string) => {
    if (get(name) === undefined) problems.push(`${name}: is required ${reason}`);
  };

  const secret = get('SESSION_SECRET');
  const production = get('NODE_ENV') === 'production';
  if (secret !== undefined && secret.length < MIN_SESSION_SECRET_CHARS) {
    problems.push(
      `SESSION_SECRET: must be at least ${MIN_SESSION_SECRET_CHARS} characters (generate one with: openssl rand -hex 32)`,
    );
  }
  if (production && secret === undefined) {
    problems.push(
      `SESSION_SECRET: is required in production and must be at least ${MIN_SESSION_SECRET_CHARS} characters (generate one with: openssl rand -hex 32)`,
    );
  }
  if (production && secret === DEV_SESSION_SECRET) {
    problems.push('SESSION_SECRET: is the built-in development secret; set your own value');
  }

  if (get('STORAGE_DRIVER') === 's3') {
    for (const name of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      need(name, 'when STORAGE_DRIVER=s3');
    }
  }
  if (get('PROMPT_ENHANCER') === 'openai') need('OPENAI_API_KEY', 'when PROMPT_ENHANCER=openai');
  if (get('PROMPT_ENHANCER') === 'anthropic') {
    need('ANTHROPIC_API_KEY', 'when PROMPT_ENHANCER=anthropic');
  }
  if (get('MODERATION_PROVIDER') === 'openai') {
    need('OPENAI_API_KEY', 'when MODERATION_PROVIDER=openai');
  }
  return problems;
}

/** Parses `source` (default `process.env`) without touching the memoized value. */
export function parseEnv(source: Readonly<Record<string, string | undefined>> = process.env): Env {
  const result = envSchema.safeParse(source);
  const problems = [
    ...(result.success
      ? []
      : result.error.issues.map((issue) => {
          const name = issue.path.join('.');
          return name ? `${name}: ${issue.message}` : issue.message;
        })),
    ...crossFieldProblems(source),
  ];
  if (!result.success || problems.length > 0) throw new EnvError(problems);
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const env = parseEnv();
  if (env.NODE_ENV !== 'test' && !process.env.SESSION_SECRET?.trim()) {
    getLogger().warn(
      'SESSION_SECRET is not set: using an insecure development default. Set it before deploying.',
    );
  }
  cached = env;
  return env;
}

/** Forgets the memoized env so the next `getEnv()` re-reads `process.env`. For tests only. */
export function resetEnvForTests(): void {
  cached = undefined;
}

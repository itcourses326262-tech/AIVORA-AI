import 'server-only';
import { z } from 'zod';
import { billingConfigProblems } from '@/lib/billing/gateway-config';
import { DEFAULT_VAT_RATE_PERCENT } from '@/lib/billing/plans';
import { BILLING_GATEWAY_SETTINGS } from '@/lib/billing/types';
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

/** `gs://my-bucket/` is the bucket `my-bucket`. Blank after stripping means unset. */
const bareBucketName = (value: string) =>
  value
    .trim()
    .replace(/^gs:\/\//i, '')
    .replace(/\/+$/, '') || undefined;

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
    STORAGE_DRIVER: choice(['local', 's3', 'gcs'], 'local'),
    STORAGE_LOCAL_DIR: text(z.string().default('./data/media')),
    S3_ENDPOINT: text(z.url({ error: 'must be a URL such as https://s3.example.com' }).optional()),
    S3_REGION: text(z.string().default('auto')),
    S3_BUCKET: text(z.string().optional()),
    S3_ACCESS_KEY_ID: text(z.string().optional()),
    S3_SECRET_ACCESS_KEY: text(z.string().optional()),
    S3_FORCE_PATH_STYLE: flag(false),
    S3_SIGNED_URL_TTL_SEC: whole(900, 60, 604_800),
    // Firebase / Google Cloud. The first four are the web app's public identifiers (they ship to
    // every browser by design; Firebase protects data with rules and authorized domains, not by
    // hiding them). The service account is the one secret: it lets this server write the bucket.
    FIREBASE_API_KEY: text(z.string().optional()),
    FIREBASE_AUTH_DOMAIN: text(z.string().optional()),
    FIREBASE_PROJECT_ID: text(z.string().optional()),
    FIREBASE_APP_ID: text(z.string().optional()),
    /** `off` hides the Google button even when the settings above are present. */
    FIREBASE_AUTH: choice(['auto', 'off'], 'auto'),
    /**
     * The Cloud Storage bucket of the Firebase project (`<project>.firebasestorage.app`). The console
     * shows it as `gs://<name>`: that and a trailing slash are removed here, so the driver id and
     * every consumer see one value.
     */
    FIREBASE_STORAGE_BUCKET: text(z.string().transform(bareBucketName).optional()),
    /** Path of the downloaded service-account JSON (preferred), or the JSON text itself. */
    FIREBASE_SERVICE_ACCOUNT_FILE: text(z.string().optional()),
    FIREBASE_SERVICE_ACCOUNT_JSON: text(z.string().optional()),
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
    /** How many trusted reverse proxies append to `X-Forwarded-For` (only used with TRUST_PROXY). */
    TRUSTED_PROXY_HOPS: whole(1, 1, 10),
    /** Turns every rate limit off. For end-to-end and load tests only; see `warnAboutRiskySettings`. */
    RATE_LIMIT_DISABLED: flag(false),
    /**
     * Cost protection: the most credits that may be committed to generations on paid (non-Demo)
     * providers per rolling 24 hours, across all users. 0 disables the guard. See
     * `assertWithinUpstreamBudget`; the ledger is the `upstream_spend` table, which deleting a
     * generation or an account does not touch.
     */
    DAILY_UPSTREAM_BUDGET_CREDITS: whole(0, 0, 1_000_000_000),
    /** Outgoing email. `SMTP_URL` (`smtp://user:pass@host:587`, `smtps://` for implicit TLS) or the parts. */
    SMTP_URL: text(
      z.url({ protocol: /^smtps?$/, error: 'must be an smtp:// or smtps:// URL' }).optional(),
    ),
    SMTP_HOST: text(z.string().optional()),
    SMTP_PORT: text(
      z.coerce
        .number({ error: 'must be a port number' })
        .int({ error: 'must be a port number' })
        .min(1, { error: 'must be a port number' })
        .max(65_535, { error: 'must be a port number' })
        .optional(),
    ),
    SMTP_USER: text(z.string().optional()),
    SMTP_PASS: text(z.string().optional()),
    /** Implicit TLS from the first byte (port 465). Off means STARTTLS when the server offers it. */
    SMTP_SECURE: flag(false),
    /** The `From` header, `AIVORE <no-reply@example.com>`. Required once SMTP is configured. */
    EMAIL_FROM: text(
      z
        .string()
        .max(320)
        .regex(/^[^\r\n]+$/, { error: 'must be a single line' })
        .regex(/@/, { error: 'must contain an email address' })
        .optional(),
    ),
    /** `auto`: required exactly when SMTP is configured. `required`/`off` force the policy. */
    EMAIL_VERIFICATION: choice(['auto', 'required', 'off'], 'auto'),
    /** Extra throwaway-mail domains (comma separated), on top of the built-in list. */
    DISPOSABLE_EMAIL_DOMAINS: lowerList,
    /** Accounts one client address may create per rolling 24 hours. 0 turns the cap off. */
    SIGNUPS_PER_IP_PER_DAY: whole(5, 0, 10_000),
    /**
     * Billing. `auto` is Moyasar in production when MOYASAR_SECRET_KEY is set (off otherwise) and
     * the in-process fake everywhere else. The fake can never be selected in production, see
     * `lib/billing/gateway-config.ts`.
     */
    BILLING_GATEWAY: choice(BILLING_GATEWAY_SETTINGS, 'auto'),
    MOYASAR_SECRET_KEY: text(z.string().optional()),
    /** Validated, but the hosted checkout does not need it (card data never touches this app). */
    MOYASAR_PUBLISHABLE_KEY: text(z.string().optional()),
    /** Shared secret configured on the Moyasar webhook (its `secret_token`). Webhooks fail closed without it. */
    MOYASAR_WEBHOOK_SECRET: text(z.string().optional()),
    MOYASAR_API_BASE: text(
      z
        .url({
          protocol: /^https?$/,
          error: 'must be an https URL such as https://api.moyasar.com/v1',
        })
        .default('https://api.moyasar.com/v1')
        .transform((value) => value.replace(/\/+$/, '')),
    ),
    MOYASAR_ALLOW_LIVE_IN_DEV: flag(false),
    MOYASAR_ALLOW_TEST_IN_PRODUCTION: flag(false),
    /** Saudi VAT included in every price (the split is stored on each order). */
    VAT_RATE_PERCENT: whole(DEFAULT_VAT_RATE_PERCENT, 0, 30),
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
  if (get('STORAGE_DRIVER') === 'gcs') {
    need('FIREBASE_STORAGE_BUCKET', 'when STORAGE_DRIVER=gcs');
    if (
      get('FIREBASE_SERVICE_ACCOUNT_FILE') === undefined &&
      get('FIREBASE_SERVICE_ACCOUNT_JSON') === undefined
    ) {
      problems.push(
        'FIREBASE_SERVICE_ACCOUNT_FILE: (or FIREBASE_SERVICE_ACCOUNT_JSON) is required when STORAGE_DRIVER=gcs',
      );
    }
  }
  // The Google button needs all three public identifiers; a half-filled set would show a button
  // that cannot work, so it is reported instead.
  const firebaseWeb = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID'].filter(
    (name) => get(name) !== undefined,
  );
  if (firebaseWeb.length > 0 && firebaseWeb.length < 3) {
    for (const name of ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID']) {
      need(name, 'together with the other Firebase sign-in settings');
    }
  }
  if (get('PROMPT_ENHANCER') === 'openai') need('OPENAI_API_KEY', 'when PROMPT_ENHANCER=openai');
  if (get('PROMPT_ENHANCER') === 'anthropic') {
    need('ANTHROPIC_API_KEY', 'when PROMPT_ENHANCER=anthropic');
  }
  if (get('MODERATION_PROVIDER') === 'openai') {
    need('OPENAI_API_KEY', 'when MODERATION_PROVIDER=openai');
  }

  const smtpUrl = get('SMTP_URL');
  const smtpHost = get('SMTP_HOST');
  if (smtpUrl !== undefined && smtpHost !== undefined) {
    problems.push(
      'SMTP_URL: set either SMTP_URL or SMTP_HOST (with SMTP_PORT, SMTP_USER, SMTP_PASS), not both',
    );
  }
  if (smtpUrl !== undefined || smtpHost !== undefined) {
    need('EMAIL_FROM', 'when SMTP is configured');
  }
  if (get('SMTP_USER') !== undefined) need('SMTP_PASS', 'when SMTP_USER is set');
  if (production && get('EMAIL_VERIFICATION') === 'required' && !smtpUrl && !smtpHost) {
    problems.push(
      'EMAIL_VERIFICATION: required needs SMTP_URL (or SMTP_HOST) in production, otherwise nobody could ever verify their address',
    );
  }
  problems.push(...billingProblems(get));
  return problems;
}

/** Billing rules (gateway choice, key safety, API host); see `lib/billing/gateway-config.ts`. */
function billingProblems(get: (name: string) => string | undefined): string[] {
  const nodeEnv = get('NODE_ENV');
  const setting = get('BILLING_GATEWAY');
  const flagOn = (name: string) => /^(true|1|yes|on)$/i.test(get(name) ?? '');
  const problems = billingConfigProblems({
    nodeEnv: nodeEnv === 'production' || nodeEnv === 'test' ? nodeEnv : 'development',
    gateway: BILLING_GATEWAY_SETTINGS.find((candidate) => candidate === setting) ?? 'auto',
    secretKey: get('MOYASAR_SECRET_KEY'),
    publishableKey: get('MOYASAR_PUBLISHABLE_KEY'),
    webhookSecret: get('MOYASAR_WEBHOOK_SECRET'),
    allowLiveInDev: flagOn('MOYASAR_ALLOW_LIVE_IN_DEV'),
    allowTestInProduction: flagOn('MOYASAR_ALLOW_TEST_IN_PRODUCTION'),
  });
  // The API host receives our secret key in an Authorization header, so it must be Moyasar's.
  // Tests may point it at a local stub.
  const base = get('MOYASAR_API_BASE');
  if (base !== undefined && nodeEnv !== 'test') {
    try {
      const url = new URL(base);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || !(host === 'moyasar.com' || host.endsWith('.moyasar.com'))) {
        problems.push(
          'MOYASAR_API_BASE: must be an https URL on moyasar.com (it receives our secret key)',
        );
      }
    } catch {
      // Not a URL: the field rule above already reports it.
    }
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

interface EnvMemory {
  env?: Env;
  /** The hot-reloadable values `env` was parsed with. */
  stamp: string;
}

const processMemory: EnvMemory = { stamp: '' };
const SHARED_MEMORY_KEY = Symbol.for('aivore.env');

/**
 * Where the parsed env is remembered. In development the dev server evaluates this module more than
 * once (the route graph and the worker graph, and again after every `.env.local` change), so the
 * memory lives on `globalThis` there and every copy agrees on one env. Everywhere else it is plain
 * module state, fixed for the life of the process.
 */
function memory(): EnvMemory {
  if (process.env.NODE_ENV !== 'development') return processMemory;
  const shared = globalThis as Record<symbol, EnvMemory | undefined>;
  return (shared[SHARED_MEMORY_KEY] ??= { stamp: '' });
}

/**
 * The settings a developer changes while the site is running: provider keys, the Demo switch and
 * the spend cap. `next dev` reloads `.env.local` into `process.env` when it changes, so in
 * development `getEnv()` picks these up when one differs from what was parsed. That is what lets
 * `npm run setup:fal` take effect without restarting the site. Every other setting keeps the value
 * it had at start-up. Never consulted in production or in tests, where the environment is fixed
 * for the life of the process.
 */
const HOT_RELOAD_NAMES = [
  'FAL_KEY',
  'OPENAI_API_KEY',
  'REPLICATE_API_TOKEN',
  'ENABLE_MOCK_PROVIDER',
  'DAILY_UPSTREAM_BUDGET_CREDITS',
] as const satisfies readonly (keyof Env)[];

function hotReloadStamp(): string {
  return HOT_RELOAD_NAMES.map((name) => process.env[name] ?? '').join('\u0000');
}

export function getEnv(): Env {
  const remembered = memory();
  if (remembered.env) {
    if (remembered.env.NODE_ENV !== 'development' || hotReloadStamp() === remembered.stamp) {
      return remembered.env;
    }
    return reloadHotSettings(remembered, remembered.env);
  }
  const stamp = hotReloadStamp();
  const env = parseEnv();
  if (env.NODE_ENV !== 'test' && !process.env.SESSION_SECRET?.trim()) {
    getLogger().warn(
      'SESSION_SECRET is not set: using an insecure development default. Set it before deploying.',
    );
  }
  remembered.env = env;
  remembered.stamp = stamp;
  warnAboutRiskySettings(env);
  return env;
}

/**
 * Development only: parses again after one of {@link HOT_RELOAD_NAMES} changed and applies just
 * those values to the settings in use. A value that does not parse (a half-typed edit) keeps the
 * settings in use and says so once, instead of failing every request until the file is fixed.
 */
function reloadHotSettings(remembered: EnvMemory, previous: Env): Env {
  remembered.stamp = hotReloadStamp();
  try {
    const parsed = parseEnv();
    const next: Env = { ...previous };
    for (const name of HOT_RELOAD_NAMES) Object.assign(next, { [name]: parsed[name] });
    remembered.env = next;
    getLogger().info('Reloaded provider settings from the environment.', {
      fal: Boolean(next.FAL_KEY),
      openai: Boolean(next.OPENAI_API_KEY),
      replicate: Boolean(next.REPLICATE_API_TOKEN),
    });
    return next;
  } catch (error) {
    getLogger().warn(
      'The environment changed but does not parse; keeping the previous settings until it is fixed.',
      { problems: error instanceof EnvError ? error.problems : String(error) },
    );
    return previous;
  }
}

/**
 * Settings that are legitimate in some setups but dangerous when left on by accident. Logged once
 * per process, from the first `getEnv()`, which is also what the worker start-up and the first
 * request call, so the line is in the log right after boot.
 */
function warnAboutRiskySettings(env: Env): void {
  const log = getLogger();
  if (env.RATE_LIMIT_DISABLED) {
    log.warn(
      'RATE_LIMIT_DISABLED=true: ALL rate limits (login, register, API) are OFF. This is meant for end-to-end and load tests only. Never run a public deployment like this.',
    );
  }
  if (env.ADMIN_EMAILS.length > 0 && env.NODE_ENV !== 'test') {
    log.warn(
      'ADMIN_EMAILS is set: whoever registers one of these addresses first becomes an admin, and emails are not verified. Register the admin accounts right after deploying, or create them with `npm run admin -- create-user`.',
      { admins: env.ADMIN_EMAILS.length },
    );
  }
  const hasPaidProviderKey = Boolean(env.FAL_KEY || env.OPENAI_API_KEY || env.REPLICATE_API_TOKEN);
  if (
    env.NODE_ENV === 'production' &&
    hasPaidProviderKey &&
    env.DAILY_UPSTREAM_BUDGET_CREDITS === 0
  ) {
    log.warn(
      'DAILY_UPSTREAM_BUDGET_CREDITS=0 with a paid provider key set: nothing limits what the providers can bill you per day. Set it to the most credits you are willing to spend upstream in 24 hours (see docs/LAUNCH.md).',
    );
  }
  if (env.NODE_ENV === 'production' && !env.TRUST_PROXY) {
    log.warn(
      'TRUST_PROXY=false: the client address is not available to the app, so anonymous visitors share one rate-limit budget per route (signed-in users are limited per account). Run behind a reverse proxy you control and set TRUST_PROXY=true.',
    );
  }
}

/** Forgets the memoized env so the next `getEnv()` re-reads `process.env`. For tests only. */
export function resetEnvForTests(): void {
  processMemory.env = undefined;
  processMemory.stamp = '';
  delete (globalThis as Record<symbol, EnvMemory | undefined>)[SHARED_MEMORY_KEY];
}

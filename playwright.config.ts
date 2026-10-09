import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { E2E_FILES, E2E_PINNED_ENV, E2E_SESSION_SECRET, e2ePorts } from './e2e/env';
import { ISOLATED_ENV_KEYS } from './tests/helpers/isolated-env';

// Three processes: the application (PW_PORT), a second application whose mail goes through SMTP
// (PW_PORT + 1) and the SMTP sink that receives it (PW_PORT + 2).
const PORTS = e2ePorts(Number(process.env.PW_PORT ?? 3200));
const BASE_URL = `http://localhost:${PORTS.app}`;
const SMTP_BASE_URL = `http://localhost:${PORTS.smtpApp}`;
// The specs that need a server with a mail relay (so e-mail confirmation is required, as in
// production) live in e2e/smtp/ and run in their own project against their own server.
const SMTP_SPECS = '**/smtp/**/*.spec.ts';
// PW_SKIP_BUILD=1 serves the `.next` that is already there instead of building first: for repeated
// runs of an unchanged tree (a stale build is the caller's problem). The default always builds.
const BUILD_STEP = process.env.PW_SKIP_BUILD === '1' ? '' : 'npm run build && ';
const RETRIES = Number(process.env.PW_RETRIES ?? (process.env.CI ? 1 : 0));
// Three workers suit a four-core laptop; a CI runner has two cores.
const WORKERS = Number(process.env.PW_WORKERS ?? (process.env.CI ? 2 : 3));

// The browser bundle in this environment is older than the one Playwright pins, so launch the
// pre-installed Chromium explicitly. Set PW_CHROMIUM_PATH to override; never run `playwright install`.
function resolveChromiumPath(): string | undefined {
  const fromEnv = process.env.PW_CHROMIUM_PATH;
  if (fromEnv) return fromEnv;
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(browsersRoot)) return undefined;
  const revisions = readdirSync(browsersRoot)
    .map((name) => /^chromium-(\d+)$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  for (const match of revisions) {
    const candidate = join(browsersRoot, match[0], 'chrome-linux', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

// Playwright re-evaluates this file in every worker. The first (main) evaluation creates the
// scratch directory and publishes it through the environment, so workers share it and only the
// main process cleans it up.
function resolveScratchDir(): string {
  const existing = process.env.AIVORE_E2E_DIR;
  if (existing) return existing;
  const dir = mkdtempSync(join(tmpdir(), 'aivore-e2e-'));
  process.env.AIVORE_E2E_DIR = dir;
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const scratchDir = resolveScratchDir();
const executablePath = resolveChromiumPath();

/**
 * The environment of an application server: production mode, the Demo provider only, every
 * pinned tunable, and every key that could reach a real service blanked. Next loads `.env.local`
 * and `.env` even in production mode, so a developer's provider keys would be picked up and e2e
 * runs would call (and bill) real APIs. A variable that is already defined, even as '', is never
 * overwritten by dotenv, and server/env.ts treats a blank as unset. The same keys are deleted for
 * unit tests in tests/setup.ts.
 */
function serverEnv(overrides: Record<string, string>): Record<string, string> {
  return {
    NODE_ENV: 'production',
    STORAGE_DRIVER: 'local',
    SESSION_SECRET: E2E_SESSION_SECRET,
    ENABLE_MOCK_PROVIDER: 'true',
    WORKER_MODE: 'inline',
    // Several tests generate at once; the default two slots would only make them queue.
    WORKER_CONCURRENCY: '6',
    // Tests create many accounts and sessions from one address.
    RATE_LIMIT_DISABLED: 'true',
    LOG_LEVEL: 'warn',
    ...Object.fromEntries(ISOLATED_ENV_KEYS.map((key) => [key, ''])),
    ...E2E_PINNED_ENV,
    MODERATION_PROVIDER: 'none',
    PROMPT_ENHANCER: 'heuristic',
    TRUST_PROXY: 'false',
    ...overrides,
  };
}

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // Every test registers its own account, so tests never depend on each other or on order.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: RETRIES,
  workers: WORKERS,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'en-US',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'chromium', testIgnore: SMTP_SPECS, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium-smtp',
      testMatch: SMTP_SPECS,
      use: { ...devices['Desktop Chrome'], baseURL: SMTP_BASE_URL },
    },
  ],
  webServer: [
    {
      name: 'smtp-sink',
      command: 'npx tsx e2e/support/smtp-sink-server.ts',
      port: PORTS.smtpSink,
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        SMTP_SINK_PORT: String(PORTS.smtpSink),
        SMTP_SINK_FILE: join(scratchDir, E2E_FILES.smtpSink),
      },
    },
    {
      name: 'app',
      // A long keep-alive: Node closes idle sockets after 5 s, which races with the test client
      // reusing one (ECONNRESET on a request that did nothing wrong).
      command: `${BUILD_STEP}npm run start -- -p ${PORTS.app} --keepAliveTimeout 120000`,
      url: BASE_URL,
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: serverEnv({
        APP_URL: BASE_URL,
        DATABASE_PATH: join(scratchDir, 'aivore.db'),
        STORAGE_LOCAL_DIR: join(scratchDir, 'media'),
      }),
    },
    {
      // The same build with a mail relay configured, which switches e-mail confirmation on
      // (EMAIL_VERIFICATION=auto is "required" exactly when SMTP is set up: the production default).
      // It starts after the application, whose command built `.next`.
      name: 'app-smtp',
      command: `npm run start -- -p ${PORTS.smtpApp} --keepAliveTimeout 120000`,
      url: SMTP_BASE_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: serverEnv({
        APP_URL: SMTP_BASE_URL,
        DATABASE_PATH: join(scratchDir, 'smtp-app', 'aivore.db'),
        STORAGE_LOCAL_DIR: join(scratchDir, 'smtp-app', 'media'),
        SMTP_URL: `smtp://127.0.0.1:${PORTS.smtpSink}`,
        EMAIL_FROM: 'AIVORE <no-reply@e2e.example.com>',
        EMAIL_VERIFICATION: 'auto',
      }),
    },
  ],
});

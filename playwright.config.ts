import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { ISOLATED_ENV_KEYS } from './tests/helpers/isolated-env';

const PORT = Number(process.env.PW_PORT ?? 3200);
const BASE_URL = `http://localhost:${PORT}`;

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

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: BASE_URL,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      APP_URL: BASE_URL,
      DATABASE_PATH: join(scratchDir, 'aivore.db'),
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: join(scratchDir, 'media'),
      SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789abcdef',
      ENABLE_MOCK_PROVIDER: 'true',
      WORKER_MODE: 'inline',
      SIGNUP_ENABLED: 'true',
      SIGNUP_BONUS_CREDITS: '50',
      LOG_LEVEL: 'warn',
      // `next start` loads `.env.local` and `.env` even in production mode, so a developer's
      // provider keys would be picked up and e2e runs would call (and bill) real APIs. A variable
      // that is already defined, even as '', is never overwritten by dotenv, and server/env.ts
      // treats a blank as unset. The same keys are deleted for unit tests in tests/setup.ts.
      ...Object.fromEntries(ISOLATED_ENV_KEYS.map((key) => [key, ''])),
      MODERATION_PROVIDER: 'none',
      PROMPT_ENHANCER: 'heuristic',
      TRUST_PROXY: 'false',
    },
  },
});

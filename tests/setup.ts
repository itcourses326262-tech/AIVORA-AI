import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

// Isolation-critical values are forced so a developer's shell or .env can never make a test
// touch a real database, real media or a paid provider.
const forced: Record<string, string> = {
  DATABASE_PATH: ':memory:',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: join(tmpdir(), 'aivore-vitest-media'),
  ENABLE_MOCK_PROVIDER: 'true',
  WORKER_MODE: 'off',
  MODERATION_PROVIDER: 'none',
};
Object.assign(process.env, forced);

for (const key of [
  'OPENAI_API_KEY',
  'FAL_KEY',
  'REPLICATE_API_TOKEN',
  'ANTHROPIC_API_KEY',
  'ADMIN_EMAILS',
  'MODERATION_BLOCKLIST',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
]) {
  delete process.env[key];
}

const defaults: Record<string, string> = {
  APP_URL: 'http://localhost:3000',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789abcdef',
  SIGNUP_ENABLED: 'true',
  SIGNUP_BONUS_CREDITS: '50',
  LOG_LEVEL: 'error',
};
for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}

// Component tests (*.dom.test.tsx) run under jsdom; node tests skip this to stay fast.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(cleanup);
}

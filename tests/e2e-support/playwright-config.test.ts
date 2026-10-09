import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { E2E_LIMITS, E2E_PINNED_ENV, E2E_SESSION_SECRET } from '../../e2e/env';
import { isEmailVerificationRequired } from '@/server/auth/email-policy';
import { parseEnv } from '@/server/env';

/**
 * The end-to-end servers are configured in `playwright.config.ts`, and a mistake there is only seen
 * after a build and several minutes of tests. These tests read the configuration and run it
 * through the application's own environment parser, so a missing pin, a server that can reach a
 * real service or an SMTP setup the application would refuse fails in a second.
 */

type Server = NonNullable<Extract<PlaywrightTestConfig['webServer'], unknown[]>[number]>;

let directory: string;
let config: PlaywrightTestConfig;
let servers: Server[];

function server(name: string): Server {
  const found = servers.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no web server named ${name}`);
  return found;
}

function envOf(name: string): Record<string, string> {
  const env = server(name).env;
  if (!env) throw new Error(`${name} has no env`);
  return env;
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'aivore-config-test-'));
  process.env.AIVORE_E2E_DIR = directory;
  config = (await import('../../playwright.config')).default;
  servers = Array.isArray(config.webServer) ? config.webServer : [];
});

afterAll(() => {
  delete process.env.AIVORE_E2E_DIR;
  rmSync(directory, { recursive: true, force: true });
});

describe('the servers of an end-to-end run', () => {
  it('are the SMTP sink, the application and the application with a mail relay', () => {
    expect(servers.map((candidate) => candidate.name)).toEqual(['smtp-sink', 'app', 'app-smtp']);
  });

  it.each(['app', 'app-smtp'])('%s is production with the pinned limits and secret', (name) => {
    const env = envOf(name);
    expect(env.NODE_ENV).toBe('production');
    expect(env.SESSION_SECRET).toBe(E2E_SESSION_SECRET);
    expect(env.ENABLE_MOCK_PROVIDER).toBe('true');
    expect(env.RATE_LIMIT_DISABLED).toBe('true');
    for (const [key, value] of Object.entries(E2E_PINNED_ENV)) {
      expect(env[key], key).toBe(value);
    }
  });

  it.each(['app', 'app-smtp'])('%s pins every tunable the specs depend on', (name) => {
    // Written out, not read from E2E_PINNED_ENV: a pin that was dropped from there must show.
    for (const key of [
      'SIGNUP_ENABLED',
      'SIGNUP_BONUS_CREDITS',
      'MAX_ACTIVE_PER_USER',
      'MAX_UPLOAD_MB',
      'VAT_RATE_PERCENT',
      'MAX_ATTEMPTS',
      'GENERATION_TIMEOUT_SEC_IMAGE',
      'GENERATION_TIMEOUT_SEC_VIDEO',
      'DAILY_UPSTREAM_BUDGET_CREDITS',
    ]) {
      expect(envOf(name)[key], `${name} must set ${key}, or .env.local decides`).toMatch(
        /^\d+$|^true$/,
      );
    }
  });

  it.each(['app', 'app-smtp'])('%s is accepted by the application and reads the limits', (name) => {
    const parsed = parseEnv(envOf(name));
    expect(parsed.MAX_ACTIVE_PER_USER).toBe(E2E_LIMITS.maxActivePerUser);
    expect(parsed.MAX_UPLOAD_MB).toBe(E2E_LIMITS.maxUploadMb);
    expect(parsed.VAT_RATE_PERCENT).toBe(E2E_LIMITS.vatRatePercent);
    expect(parsed.SIGNUP_BONUS_CREDITS).toBe(E2E_LIMITS.signupBonusCredits);
    expect(parsed.DAILY_UPSTREAM_BUDGET_CREDITS).toBe(0);
    expect(parsed.BILLING_GATEWAY).toBe('auto');
    expect(parsed.FAL_KEY).toBeUndefined();
    expect(parsed.MOYASAR_SECRET_KEY).toBeUndefined();
  });

  it('keep the default application without a mail relay, so confirmation is off, and app-smtp with one, so it is on', () => {
    expect(isEmailVerificationRequired(parseEnv(envOf('app')))).toBe(false);
    const withRelay = parseEnv(envOf('app-smtp'));
    expect(withRelay.EMAIL_VERIFICATION).toBe('auto');
    expect(isEmailVerificationRequired(withRelay)).toBe(true);
  });

  it('send the mail of app-smtp to the sink and nowhere else', () => {
    const sink = server('smtp-sink');
    const url = new URL(envOf('app-smtp').SMTP_URL ?? '');
    expect(url.protocol).toBe('smtp:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(Number(url.port)).toBe(sink.port);
    expect(sink.env?.SMTP_SINK_PORT).toBe(String(sink.port));
    expect(sink.env?.SMTP_SINK_FILE?.startsWith(directory)).toBe(true);
    expect(envOf('app-smtp').EMAIL_FROM).toMatch(/@/);
  });

  it('use separate ports, databases and media folders inside the scratch directory', () => {
    const ports = [server('smtp-sink').port, ...['app', 'app-smtp'].map((n) => portOf(server(n)))];
    expect(new Set(ports).size).toBe(3);
    const places = ['app', 'app-smtp'].flatMap((name) => [
      envOf(name).DATABASE_PATH,
      envOf(name).STORAGE_LOCAL_DIR,
    ]);
    expect(new Set(places).size).toBe(4);
    for (const place of places) expect(place?.startsWith(directory), place).toBe(true);
  });

  it('start the second application only after the first, which builds', () => {
    expect(servers.map((candidate) => candidate.name).indexOf('app')).toBeLessThan(
      servers.map((candidate) => candidate.name).indexOf('app-smtp'),
    );
    expect(server('app-smtp').command).not.toMatch(/npm run build/);
  });
});

function portOf(candidate: Server): number {
  return Number(new URL(candidate.url ?? '').port);
}

describe('the projects of an end-to-end run', () => {
  it('keep the specs that need a mail relay out of the default project and in their own', () => {
    const [main, smtp] = config.projects ?? [];
    expect(main?.name).toBe('chromium');
    expect(smtp?.name).toBe('chromium-smtp');
    const ignored = String(main?.testIgnore);
    const matched = String(smtp?.testMatch);
    expect(ignored).toBe(matched);
    expect(matched).toContain('smtp');
    expect(smtp?.use?.baseURL).toBe(server('app-smtp').url);
    expect(config.use?.baseURL).toBe(server('app').url);
  });
});

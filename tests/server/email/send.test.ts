import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LoggerModule from '@/server/logger';
import {
  flushEmails,
  getEmailTransport,
  getOutbox,
  isSmtpConfigured,
  queueEmail,
  renderEmail,
  sendEmail,
  setEmailTimingForTests,
  setEmailTransportOverride,
  emailFrom,
  type EmailMessage,
  type EmailTransport,
  type OutgoingEmail,
} from '@/server/email';
import { resetEnvForTests } from '@/server/env';
import { cleanEmailState } from './support';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/server/logger', async (importOriginal) => {
  const original = await importOriginal<typeof LoggerModule>();
  return { ...original, getLogger: () => ({ ...log, level: 'debug', child: () => log }) };
});

cleanEmailState();

beforeEach(() => {
  for (const fn of Object.values(log)) fn.mockClear();
});

function message(to = 'layla@example.com'): EmailMessage {
  return renderEmail({
    kind: 'password_reset',
    locale: 'en',
    to,
    name: 'Layla',
    link: 'https://aivore.example/reset-password?token=SECRET-TOKEN',
    ttlHours: 1,
  });
}

function fakeTransport(send: (message: OutgoingEmail) => Promise<void>) {
  const calls: OutgoingEmail[] = [];
  const transport: EmailTransport = {
    name: 'smtp',
    send: async (outgoing) => {
      calls.push(outgoing);
      await send(outgoing);
    },
  };
  setEmailTransportOverride(transport);
  return calls;
}

describe('queueEmail', () => {
  it('returns at once: the transport is not even called before the caller continues', async () => {
    const calls = fakeTransport(async () => {});
    queueEmail(message());
    expect(calls).toHaveLength(0);
    await flushEmails();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ to: 'layla@example.com', kind: 'password_reset' });
  });

  it('does not wait for a slow relay, and flush waits for it', async () => {
    let release: () => void = () => {};
    const calls = fakeTransport(() => new Promise<void>((resolve) => (release = resolve)));
    const startedAt = Date.now();
    queueEmail(message());
    await new Promise((resolve) => setImmediate(resolve));
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(calls).toHaveLength(1);

    let flushed = false;
    const flushing = flushEmails().then(() => (flushed = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(flushed).toBe(false);
    release();
    await flushing;
    expect(flushed).toBe(true);
  });

  it('never throws into the caller, whatever the transport does', async () => {
    fakeTransport(async () => {
      throw new Error('relay down');
    });
    expect(() => queueEmail(message())).not.toThrow();
    await expect(flushEmails()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      'Email could not be delivered',
      expect.objectContaining({ reason: 'relay down' }),
    );
  });

  it('delivers every queued message once, in order', async () => {
    const calls = fakeTransport(async () => {});
    for (const to of ['a@example.com', 'b@example.com', 'c@example.com']) queueEmail(message(to));
    await flushEmails();
    expect(calls.map((call) => call.to)).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ]);
  });
});

describe('sendEmail', () => {
  it('stamps the From address from EMAIL_FROM, or the local default', async () => {
    const calls = fakeTransport(async () => {});
    await sendEmail(message());
    expect(calls[0]?.from).toBe('AIVORE <no-reply@aivore.local>');

    vi.stubEnv('EMAIL_FROM', 'Support <help@aivore.example>');
    resetEnvForTests();
    expect(emailFrom()).toBe('Support <help@aivore.example>');
    await sendEmail(message());
    expect(calls[1]?.from).toBe('Support <help@aivore.example>');
  });

  it('retries once after a transient failure and reports success', async () => {
    let attempt = 0;
    const calls = fakeTransport(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('timeout talking to relay');
    });
    await expect(sendEmail(message())).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(log.warn).toHaveBeenCalledWith(
      'Email delivery failed, retrying once',
      expect.objectContaining({ kind: 'password_reset', to: 'l***@example.com' }),
    );
    expect(log.error).not.toHaveBeenCalled();
    // The first failure left no failure record: the second attempt worked.
    expect(getOutbox().filter((entry) => entry.status === 'failed')).toEqual([]);
  });

  it('gives up after the second failure: error log, failure record, no secret anywhere', async () => {
    const calls = fakeTransport(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.1:587');
    });
    const result = await sendEmail(message());
    expect(result).toEqual({ ok: false, error: 'connect ECONNREFUSED 10.0.0.1:587' });
    expect(calls).toHaveLength(2);

    expect(log.error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify([...log.warn.mock.calls, ...log.error.mock.calls]);
    expect(logged).not.toContain('SECRET-TOKEN');
    expect(logged).not.toContain('layla@example.com');

    const failed = getOutbox().filter((entry) => entry.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ to: 'l***@example.com', kind: 'password_reset' });
    expect(JSON.stringify(failed[0])).not.toContain('SECRET-TOKEN');
  });

  it('does not retry a permanent refusal (a 5xx answer from the server)', async () => {
    const calls = fakeTransport(async () => {
      throw Object.assign(new Error('550 no such mailbox'), { responseCode: 550 });
    });
    const result = await sendEmail(message());
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('still retries a temporary refusal (a 4xx answer)', async () => {
    const calls = fakeTransport(async () => {
      throw Object.assign(new Error('451 try later'), { responseCode: 451 });
    });
    await sendEmail(message());
    expect(calls).toHaveLength(2);
  });

  it('gives each attempt a deadline', async () => {
    setEmailTimingForTests({ timeoutMs: 30, retryDelayMs: 0 });
    const calls = fakeTransport(() => new Promise<void>(() => {}));
    const result = await sendEmail(message());
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toMatch(/timed out after 30 ms/);
  });
});

describe('transport selection', () => {
  it('writes to the outbox when SMTP is not configured', () => {
    expect(isSmtpConfigured()).toBe(false);
    expect(getEmailTransport().name).toBe('outbox');
  });

  it.each([[{ SMTP_URL: 'smtp://mail.example.com' }], [{ SMTP_HOST: 'mail.example.com' }]])(
    'uses SMTP for %j',
    (variables) => {
      for (const [key, value] of Object.entries(variables)) vi.stubEnv(key, value);
      vi.stubEnv('EMAIL_FROM', 'a@example.com');
      resetEnvForTests();
      expect(isSmtpConfigured()).toBe(true);
      expect(getEmailTransport().name).toBe('smtp');
    },
  );

  it('keeps one SMTP transport per configuration and builds a new one when it changes', () => {
    vi.stubEnv('SMTP_HOST', 'one.example.com');
    vi.stubEnv('EMAIL_FROM', 'a@example.com');
    resetEnvForTests();
    const first = getEmailTransport();
    expect(getEmailTransport()).toBe(first);
    vi.stubEnv('SMTP_HOST', 'two.example.com');
    resetEnvForTests();
    expect(getEmailTransport()).not.toBe(first);
  });

  it('warns once in production when mail goes nowhere but the outbox', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', 'a-production-secret-that-is-long-enough-0123456789');
    const fresh = await import('@/server/email/transport');
    const { resetEnvForTests: reset } = await import('@/server/env');
    reset();
    fresh.getEmailTransport();
    fresh.getEmailTransport();
    // (The environment itself also warns about TRUST_PROXY in production; only ours counts here.)
    const ours = log.warn.mock.calls.filter(([line]) =>
      /SMTP is not configured/.test(String(line)),
    );
    expect(ours).toHaveLength(1);
  });
});

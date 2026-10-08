import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import type * as LoggerModule from '@/server/logger';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEnv, resetEnvForTests } from '@/server/env';
import {
  clearOutbox,
  getOutbox,
  lastOutboxMessage,
  outboxFilePath,
  renderEmail,
  sendEmail,
  type EmailMessage,
} from '@/server/email';
import { outboxTransport, recordFailedDelivery } from '@/server/email/outbox';
import { cleanEmailState } from './support';

const log = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/server/logger', async (importOriginal) => {
  const original = await importOriginal<typeof LoggerModule>();
  return { ...original, getLogger: () => ({ ...log, level: 'debug', child: () => log }) };
});

cleanEmailState();

let scratch: string | undefined;
beforeEach(() => {
  log.info.mockClear();
  log.warn.mockClear();
  log.error.mockClear();
});
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

function message(to: string, token = 'tok'): EmailMessage {
  return renderEmail({
    kind: 'password_reset',
    locale: 'en',
    to,
    name: 'Layla',
    link: `https://aivore.example/reset-password?token=${token}`,
    ttlHours: 1,
  });
}

function useDatabaseIn(directory: string): void {
  vi.stubEnv('DATABASE_PATH', join(directory, 'aivore.db'));
  resetEnvForTests();
}

describe('outbox', () => {
  it('keeps what was sent, newest last, readable by address', async () => {
    await sendEmail(message('a@example.com', 'first'));
    await sendEmail(message('b@example.com', 'second'));
    const entries = getOutbox();
    expect(entries.map((entry) => entry.to)).toEqual(['a@example.com', 'b@example.com']);
    expect(entries[0]).toMatchObject({
      status: 'sent',
      kind: 'password_reset',
      from: getEnv().EMAIL_FROM ?? 'AIVORE <no-reply@aivore.local>',
      subject: 'Reset your AIVORE password',
    });
    expect(entries[0]?.text).toContain('token=first');
    expect(entries[0]?.html).toContain('token=first');
    expect(lastOutboxMessage()?.to).toBe('b@example.com');
    expect(lastOutboxMessage('a@example.com')?.text).toContain('token=first');
    expect(lastOutboxMessage('nobody@example.com')).toBeUndefined();
    expect(entries[1]?.id).toBeGreaterThan(entries[0]?.id ?? 0);
  });

  it('is bounded: the oldest messages make room', async () => {
    for (let index = 0; index < 205; index += 1) {
      await outboxTransport.send({ ...message(`u${index}@example.com`), from: 'a@b.co' });
    }
    const entries = getOutbox();
    expect(entries).toHaveLength(200);
    expect(entries[0]?.to).toBe('u5@example.com');
    expect(entries.at(-1)?.to).toBe('u204@example.com');
  });

  it('can be emptied', async () => {
    await sendEmail(message('a@example.com'));
    clearOutbox();
    expect(getOutbox()).toEqual([]);
  });

  it('logs one notice per message without the address, the link or the body', async () => {
    await sendEmail(message('layla@example.com', 'SECRET-TOKEN'));
    expect(log.info).toHaveBeenCalledTimes(1);
    const [line, fields] = log.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(line).toMatch(/outbox/i);
    expect(line).toMatch(/nothing was sent/i);
    const logged = JSON.stringify([line, fields]);
    expect(logged).not.toContain('layla@example.com');
    expect(logged).not.toContain('SECRET-TOKEN');
    expect(fields).toMatchObject({ kind: 'password_reset', to: 'l***@example.com' });
  });

  describe('file', () => {
    it('has no file while the database is in memory (tests)', () => {
      expect(getEnv().DATABASE_PATH).toBe(':memory:');
      expect(outboxFilePath()).toBeNull();
    });

    it('appends one JSON object per line next to the database, readable by the owner only', async () => {
      scratch = mkdtempSync(join(tmpdir(), 'aivore-outbox-'));
      useDatabaseIn(scratch);
      const file = outboxFilePath();
      expect(file).toBe(join(scratch, 'outbox.jsonl'));

      await sendEmail(message('a@example.com', 'one'));
      await sendEmail(message('b@example.com', 'two'));

      const lines = readFileSync(file as string, 'utf8')
        .trim()
        .split('\n');
      expect(lines).toHaveLength(2);
      const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(parsed[0]).toMatchObject({
        to: 'a@example.com',
        status: 'sent',
        kind: 'password_reset',
      });
      expect(String(parsed[0]?.text)).toContain('token=one');
      expect(String(parsed[1]?.text)).toContain('token=two');
      expect(statSync(file as string).mode & 0o777).toBe(0o600);
      expect(log.info.mock.calls[0]?.[1]).toMatchObject({ file });
    });

    it('survives a file that cannot be written: the message stays in memory and a warning is logged', async () => {
      scratch = mkdtempSync(join(tmpdir(), 'aivore-outbox-'));
      // A path whose parent is a regular file: mkdir fails.
      useDatabaseIn(join(scratch, 'not-a-directory', 'nested'));
      await sendEmail(message('a@example.com'));
      expect(lastOutboxMessage('a@example.com')).toBeDefined();
      expect(existsSync(join(scratch, 'not-a-directory', 'nested', 'outbox.jsonl'))).toBe(true);
    });
  });

  describe('failed deliveries', () => {
    it('records metadata only: never the body, the link or the full address', () => {
      recordFailedDelivery(
        { ...message('layla@example.com', 'SECRET-TOKEN'), from: 'a@b.co' },
        'connect ECONNREFUSED',
      );
      const [entry] = getOutbox();
      expect(entry).toMatchObject({
        status: 'failed',
        kind: 'password_reset',
        to: 'l***@example.com',
        error: 'connect ECONNREFUSED',
      });
      expect(JSON.stringify(entry)).not.toContain('SECRET-TOKEN');
      expect(entry?.text).toBeUndefined();
      expect(entry?.html).toBeUndefined();
      // A failed record is not a message anybody can open.
      expect(lastOutboxMessage()).toBeUndefined();
    });
  });
});

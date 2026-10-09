import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { E2E_FILES } from '../env';

/**
 * Where the e-mail of the server under test ends up. Without SMTP (the default project) the server
 * writes every email to `outbox.jsonl` next to its database; the `smtp` project's server delivers
 * through a real SMTP connection to a sink that writes `smtp-sink.jsonl`. Nothing leaves the
 * machine either way, and `playwright.config.ts` publishes the directory as `AIVORE_E2E_DIR`.
 */
export type MailSource = 'outbox' | 'smtp';

export interface OutboxMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  status?: string;
}

function mailFile(source: MailSource): string {
  const dir = process.env.AIVORE_E2E_DIR;
  if (!dir) throw new Error('AIVORE_E2E_DIR is not set: run through playwright.config.ts');
  return join(dir, source === 'smtp' ? E2E_FILES.smtpSink : E2E_FILES.outbox);
}

export async function readOutbox(source: MailSource = 'outbox'): Promise<OutboxMessage[]> {
  try {
    const raw = await readFile(mailFile(source), 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    // The writer may be in the middle of its last line: that one is read by the next poll.
    const complete = raw.endsWith('\n') ? lines : lines.slice(0, -1);
    return complete.map((line) => JSON.parse(line) as OutboxMessage);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function messagesTo(
  address: string,
  source: MailSource = 'outbox',
): Promise<OutboxMessage[]> {
  return (await readOutbox(source)).filter(
    (message) => message.to.toLowerCase() === address.toLowerCase() && message.status !== 'failed',
  );
}

/** Waits for the `index`-th email to `address` (0 = the first) and returns it. */
export async function waitForEmail(
  address: string,
  index = 0,
  source: MailSource = 'outbox',
): Promise<OutboxMessage> {
  await expect
    .poll(async () => (await messagesTo(address, source)).length, {
      message: `an email to ${address} should arrive in the ${source === 'smtp' ? 'SMTP sink' : 'outbox'}`,
      timeout: 20_000,
      intervals: [200, 400, 800],
    })
    .toBeGreaterThan(index);
  const message = (await messagesTo(address, source))[index];
  if (!message) throw new Error(`no email #${index} to ${address}`);
  return message;
}

/**
 * Waits for the first email to `address` whose text links to `path` (a confirmation link, a reset
 * link) and returns it, whatever else was sent to that address before or after.
 */
export async function waitForEmailLinking(
  address: string,
  path: string,
  source: MailSource = 'outbox',
): Promise<OutboxMessage> {
  const find = async () =>
    (await messagesTo(address, source)).find((message) => message.text.includes(path));
  await expect
    .poll(async () => (await find()) !== undefined, {
      message: `an email to ${address} linking to ${path} should arrive`,
      timeout: 20_000,
      intervals: [200, 400, 800],
    })
    .toBe(true);
  const message = await find();
  if (!message) throw new Error(`no email to ${address} links to ${path}`);
  return message;
}

/** The first link of the email that has `path` in it, as an absolute URL. */
export function linkTo(message: OutboxMessage, path: string): string {
  const escaped = path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const match = new RegExp(`https?://[^\\s"'<>]*${escaped}[^\\s"'<>]*`).exec(message.text);
  if (!match) throw new Error(`no ${path} link in the email "${message.subject}"`);
  return match[0].replace(/&amp;/g, '&');
}

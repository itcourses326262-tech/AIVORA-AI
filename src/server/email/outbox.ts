import 'server-only';
import { appendFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logger';
import { maskEmail, type EmailKind, type EmailTransport, type OutgoingEmail } from './types';

/**
 * The transport used when SMTP is not configured: nothing leaves the machine. Messages are kept in
 * a bounded in-memory list (so tests and the dev flow can read the last one) and appended, one
 * JSON object per line, to `outbox.jsonl` next to the database file. The file holds working links,
 * so it is created readable by its owner only and is meant for development, never production.
 */

export interface OutboxEntry {
  id: number;
  at: number;
  /** `sent`: the outbox itself took the message. `failed`: SMTP gave up (metadata only, no body). */
  status: 'sent' | 'failed';
  kind: EmailKind;
  from?: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  error?: string;
}

const MAX_ENTRIES = 200;
const STORE_KEY = Symbol.for('aivore.email.outbox');
type GlobalWithOutbox = typeof globalThis & {
  [STORE_KEY]?: { entries: OutboxEntry[]; seq: number };
};

function store(): { entries: OutboxEntry[]; seq: number } {
  const scope = globalThis as GlobalWithOutbox;
  return (scope[STORE_KEY] ??= { entries: [], seq: 0 });
}

/** Where the JSON-lines file lives, or null when the database is in memory (tests). */
export function outboxFilePath(): string | null {
  const databasePath = getEnv().DATABASE_PATH;
  if (databasePath === ':memory:' || databasePath.startsWith('file::memory:')) return null;
  return resolve(dirname(resolve(databasePath)), 'outbox.jsonl');
}

function persist(entry: OutboxEntry): string | null {
  const file = outboxFilePath();
  if (!file) return null;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    return file;
  } catch (err) {
    getLogger().warn('Could not write the email outbox file', { component: 'email', err });
    return null;
  }
}

function remember(entry: Omit<OutboxEntry, 'id' | 'at'>): OutboxEntry {
  const state = store();
  state.seq += 1;
  const stored: OutboxEntry = { id: state.seq, at: Date.now(), ...entry };
  state.entries.push(stored);
  if (state.entries.length > MAX_ENTRIES)
    state.entries.splice(0, state.entries.length - MAX_ENTRIES);
  return stored;
}

export const outboxTransport: EmailTransport = {
  name: 'outbox',
  async send(message: OutgoingEmail): Promise<void> {
    const entry = remember({
      status: 'sent',
      kind: message.kind,
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    const file = persist(entry);
    getLogger().info('Email written to the outbox (SMTP is not configured, nothing was sent)', {
      component: 'email',
      kind: message.kind,
      to: maskEmail(message.to),
      ...(file ? { file } : {}),
    });
  },
};

/**
 * Records a delivery SMTP could not make. Metadata only: the body holds a working link, and a
 * secret does not belong in a file because a relay was down. The error log carries the details.
 */
export function recordFailedDelivery(message: OutgoingEmail, error: string): void {
  persist(
    remember({
      status: 'failed',
      kind: message.kind,
      to: maskEmail(message.to),
      subject: message.subject,
      error,
    }),
  );
}

/** Messages in the in-memory outbox, oldest first. */
export function getOutbox(): readonly OutboxEntry[] {
  return store().entries;
}

/** The newest message, optionally the newest one to `to`. */
export function lastOutboxMessage(to?: string): OutboxEntry | undefined {
  const entries = store().entries;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && entry.status === 'sent' && (to === undefined || entry.to === to)) return entry;
  }
  return undefined;
}

export function clearOutbox(): void {
  store().entries.length = 0;
}

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, runAdminCli } from '@/server/auth/admin/cli';
import type { CliIo } from '@/server/auth/admin/io';
import { creditLedger, users } from '@/server/db/schema';
import { getOutbox } from '@/server/email';
import { setStorageOverride } from '@/server/storage';
import { freshDb } from '../../helpers/db';
import {
  createAsset,
  createGeneration,
  createSession,
  createUser,
  fakeStorage,
} from '../../helpers/factories';
import { trustTestState } from './trust-support';

const harness = freshDb();
trustTestState();

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  storage = fakeStorage();
  setStorageOverride(storage);
});
afterEach(() => setStorageOverride(null));

interface Run {
  code: number;
  out: string;
  err: string;
}

async function run(args: string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    readSecret: async () => {
      throw new Error('no input available');
    },
    env: () => undefined,
  };
  const code = await runAdminCli(args, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const userRow = (email: string) =>
  harness.db.select().from(users).where(eq(users.email, email)).get();

describe('usage', () => {
  it('lists the new commands', async () => {
    const help = await run(['--help']);
    expect(help.code).toBe(EXIT_OK);
    for (const command of [
      'users-stats',
      'resend-verification',
      'force-verify',
      'delete-user',
      'purge-deleted',
    ]) {
      expect(help.out).toContain(command);
    }
  });

  it('still refuses stray arguments on the commands that take none', async () => {
    const result = await run(['list-users', 'surprise']);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.err).toMatch(/surprise|Unexpected/);
  });

  it('takes the email as an option or as the first argument, never both, never more', async () => {
    createUser(harness.db, { email: 'a@example.com', emailVerifiedAt: null });
    expect((await run(['force-verify', 'a@example.com'])).code).toBe(EXIT_OK);
    expect((await run(['force-verify', '--email', 'a@example.com'])).code).toBe(EXIT_OK);
    const both = await run(['force-verify', 'a@example.com', '--email', 'a@example.com']);
    expect(both.code).toBe(EXIT_USAGE);
    expect(both.err).toMatch(/not both/);
    const extra = await run(['force-verify', 'a@example.com', 'b@example.com']);
    expect(extra.code).toBe(EXIT_USAGE);
    const missing = await run(['force-verify']);
    expect(missing.code).toBe(EXIT_USAGE);
    expect(missing.err).toMatch(/Missing --email/);
  });
});

describe('users-stats', () => {
  function seed() {
    const now = Date.now();
    createUser(harness.db, {
      email: 'a@example.com',
      emailVerifiedAt: now,
      creditBalance: 10,
      createdAt: now,
    });
    createUser(harness.db, {
      email: 'b@example.com',
      emailVerifiedAt: null,
      creditBalance: 5,
      createdAt: now - 3 * 24 * 3600 * 1000,
    });
    createUser(harness.db, {
      email: 'c@example.com',
      role: 'admin',
      emailVerifiedAt: now,
      creditBalance: 0,
      createdAt: now - 20 * 24 * 3600 * 1000,
    });
    createUser(harness.db, {
      email: 'd@example.com',
      disabledAt: now,
      creditBalance: 7,
      createdAt: now - 60 * 24 * 3600 * 1000,
    });
    createUser(harness.db, {
      email: 'gone@deleted.invalid',
      deletedAt: now,
      disabledAt: now,
      creditBalance: 99,
      createdAt: now,
    });
  }

  it('summarizes accounts, confirmation, sign-ups and credits as JSON', async () => {
    seed();
    const result = await run(['users-stats', '--json']);
    expect(result.code).toBe(EXIT_OK);
    expect(JSON.parse(result.out)).toMatchObject({
      total: 5,
      active: 3,
      disabled: 1,
      deleted: 1,
      confirmed: 2,
      unconfirmed: 2,
      admins: 1,
      signups24h: 2,
      signups7d: 3,
      signups30d: 4,
      // Deleted accounts' leftover balance is not "credits held".
      credits: 22,
      policy: { confirmationRequired: false, setting: 'auto', smtpConfigured: false },
    });
  });

  it('prints a readable summary, and answers to "users stats" too', async () => {
    seed();
    for (const args of [['users-stats'], ['users', 'stats']]) {
      const result = await run(args);
      expect(result.code).toBe(EXIT_OK);
      expect(result.out).toContain('Accounts        5 (active 3, disabled 1, deleted 1)');
      expect(result.out).toContain('Email           confirmed 2, not confirmed 2');
      expect(result.out).toContain('Credits held    22');
      expect(result.out).toContain(
        'Confirmation    not required (EMAIL_VERIFICATION=auto, SMTP not configured)',
      );
    }
  });

  it('works on an empty database', async () => {
    const result = await run(['users-stats', '--json']);
    expect(JSON.parse(result.out)).toMatchObject({ total: 0, credits: 0, admins: 0 });
  });
});

describe('resend-verification', () => {
  it('mails a new link and says where it went', async () => {
    createUser(harness.db, {
      email: 'a@example.com',
      name: 'Aya',
      locale: 'en',
      emailVerifiedAt: null,
    });
    const result = await run(['resend-verification', 'a@example.com']);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('Confirmation email for a@example.com');
    expect(result.out).toContain('kept in memory');
    expect(getOutbox().map((entry) => [entry.to, entry.kind])).toEqual([
      ['a@example.com', 'verification'],
    ]);
  });

  it('may be repeated at once: an operator is not held to the 60 second gap', async () => {
    createUser(harness.db, { email: 'a@example.com', emailVerifiedAt: null });
    await run(['resend-verification', '--email', 'a@example.com']);
    await run(['resend-verification', '--email', 'a@example.com']);
    expect(getOutbox()).toHaveLength(2);
  });

  it('has nothing to send to a confirmed account, and fails for an unknown one', async () => {
    createUser(harness.db, { email: 'a@example.com', emailVerifiedAt: Date.now() });
    const done = await run(['resend-verification', 'a@example.com']);
    expect(done.code).toBe(EXIT_OK);
    expect(done.out).toContain('already confirmed');
    expect(getOutbox()).toEqual([]);
    const unknown = await run(['resend-verification', 'nobody@example.com']);
    expect(unknown.code).toBe(EXIT_FAILED);
    expect(unknown.err).toContain('No user with email nobody@example.com');
  });
});

describe('force-verify', () => {
  it('confirms without the link and grants the sign-up bonus the account never got', async () => {
    createUser(harness.db, { email: 'a@example.com', emailVerifiedAt: null, creditBalance: 0 });
    const result = await run(['force-verify', 'a@example.com']);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('Confirmed a@example.com. Granted 50 sign-up credits.');
    expect(userRow('a@example.com')).toMatchObject({ creditBalance: 50 });
    expect(userRow('a@example.com')?.emailVerifiedAt).toBeGreaterThan(0);
    expect(harness.db.select().from(creditLedger).all()).toHaveLength(1);
  });

  it('is repeatable and never pays twice', async () => {
    createUser(harness.db, { email: 'a@example.com', emailVerifiedAt: null, creditBalance: 0 });
    await run(['force-verify', 'a@example.com']);
    const again = await run(['force-verify', 'a@example.com']);
    expect(again.code).toBe(EXIT_OK);
    expect(again.out).toContain('already confirmed');
    expect(userRow('a@example.com')?.creditBalance).toBe(50);
  });

  it('fails for an unknown account', async () => {
    expect((await run(['force-verify', 'nobody@example.com'])).code).toBe(EXIT_FAILED);
  });
});

describe('delete-user', () => {
  async function withData() {
    const user = createUser(harness.db, { email: 'a@example.com', name: 'Aya', locale: 'en' });
    createSession(harness.db, user.id);
    const generation = createGeneration(harness.db, { userId: user.id, status: 'succeeded' });
    const asset = createAsset(harness.db, {
      userId: user.id,
      role: 'output',
      generationId: generation.id,
    });
    await storage.put(asset.storageKey, new Uint8Array([1]), { mimeType: 'image/png' });
    return { user, asset };
  }

  it('only shows what it would do until --yes is given', async () => {
    const { user, asset } = await withData();
    const preview = await run(['delete-user', 'a@example.com']);
    expect(preview.code).toBe(EXIT_OK);
    expect(preview.out).toContain('1 generations and 1 stored files are removed');
    expect(preview.out).toContain('Run again with --yes');
    expect(userRow('a@example.com')?.deletedAt).toBeNull();
    expect(await storage.head(asset.storageKey)).not.toBeNull();
    expect(getOutbox()).toEqual([]);
    expect(user.id).toBeTruthy();
  });

  it('deletes with --yes, like the user would, and sends the confirmation', async () => {
    const { user, asset } = await withData();
    const result = await run(['delete-user', 'a@example.com', '--yes']);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain(`Account ${user.id} deleted: 1 files removed.`);
    expect(harness.db.select().from(users).where(eq(users.id, user.id)).get()).toMatchObject({
      name: '',
      email: `${user.id}@deleted.invalid`,
    });
    expect(await storage.head(asset.storageKey)).toBeNull();
    expect(getOutbox().map((entry) => entry.kind)).toEqual(['account_deleted']);
  });

  it('finds an already deleted account by --id, and just cleans up leftovers', async () => {
    const { user } = await withData();
    await run(['delete-user', 'a@example.com', '--yes']);
    const again = await run(['delete-user', '--id', user.id, '--yes']);
    expect(again.code).toBe(EXIT_OK);
    expect(again.out).toContain('was already deleted');
    expect(
      (await run(['delete-user', '--id', 'usr_00000000000000000000000000', '--yes'])).code,
    ).toBe(EXIT_FAILED);
  });

  it('keeps the last administrator unless forced', async () => {
    createUser(harness.db, { email: 'boss@example.com', role: 'admin' });
    const refused = await run(['delete-user', 'boss@example.com', '--yes']);
    expect(refused.code).toBe(EXIT_FAILED);
    expect(refused.err).toContain('only administrator');
    expect(userRow('boss@example.com')?.deletedAt).toBeNull();
    expect((await run(['delete-user', 'boss@example.com', '--yes', '--force'])).code).toBe(EXIT_OK);
  });

  it('fails for an unknown account', async () => {
    expect((await run(['delete-user', 'nobody@example.com', '--yes'])).code).toBe(EXIT_FAILED);
  });
});

describe('purge-deleted', () => {
  it('says so when there is nothing to do', async () => {
    const result = await run(['purge-deleted']);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toBe('Nothing to clean up.');
  });

  it('finishes the clean-up of a deleted account whose files could not be removed', async () => {
    const user = createUser(harness.db, { email: 'a@example.com' });
    const asset = createAsset(harness.db, { userId: user.id, role: 'input' });
    await storage.put(asset.storageKey, new Uint8Array([1]), { mimeType: 'image/png' });
    const realDelete = storage.delete.bind(storage);
    storage.delete = async () => {
      throw new Error('storage unreachable');
    };
    await run(['delete-user', 'a@example.com', '--yes']);
    expect(await storage.head(asset.storageKey)).not.toBeNull();

    storage.delete = realDelete;
    const result = await run(['purge-deleted']);
    expect(result.out).toBe('Finished the clean-up of 1 deleted account.');
    expect(await storage.head(asset.storageKey)).toBeNull();
  });
});

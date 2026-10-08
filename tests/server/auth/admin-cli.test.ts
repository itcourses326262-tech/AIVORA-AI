import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSession, createUser } from '../../helpers/factories';
import { expectConsistentLedger } from '../../helpers/credits';
import { freshDb } from '../../helpers/db';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, runAdminCli } from '@/server/auth/admin/cli';
import type { CliIo } from '@/server/auth/admin/io';
import { creditLedger, sessions, users } from '@/server/db/schema';
import { loginUser } from '@/server/auth/users';
import { resolveSession } from '@/server/auth/sessions';
import { GOOD_PASSWORD, cleanSecurityState, passwordFixture } from './support';

const harness = freshDb();
const fixture = passwordFixture();
cleanSecurityState();

interface Run {
  code: number;
  out: string;
  err: string;
  prompts: string[];
}

async function run(
  args: string[],
  options: { secrets?: string[]; env?: Record<string, string> } = {},
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const prompts: string[] = [];
  const secrets = [...(options.secrets ?? [])];
  const io: CliIo = {
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    readSecret: async (prompt) => {
      prompts.push(prompt);
      const next = secrets.shift();
      if (next === undefined) throw new Error('no input available');
      return next;
    },
    env: (name) => options.env?.[name],
  };
  const code = await runAdminCli(args, io);
  return { code, out: out.join('\n'), err: err.join('\n'), prompts };
}

function userByEmail(email: string) {
  return harness.db.select().from(users).where(eq(users.email, email)).get();
}

describe('usage', () => {
  it('prints help and exits 0 for --help, 2 for no command', async () => {
    const help = await run(['--help']);
    expect(help.code).toBe(EXIT_OK);
    for (const command of [
      'create-user',
      'grant-credits',
      'set-role',
      'disable',
      'enable',
      'list-users',
      'reset-password',
    ]) {
      expect(help.out).toContain(command);
    }
    expect(help.out).toMatch(/exit codes/i);
    expect((await run([])).code).toBe(EXIT_USAGE);
  });

  it('rejects an unknown command and unknown or malformed options with exit 2 and the usage', async () => {
    const unknown = await run(['frobnicate']);
    expect(unknown).toMatchObject({ code: EXIT_USAGE });
    expect(unknown.err).toContain('Unknown command "frobnicate"');
    expect(unknown.err).toContain('Usage:');
    expect((await run(['enable', '--email'])).code).toBe(EXIT_USAGE);
    expect((await run(['enable', '--nope', 'x'])).code).toBe(EXIT_USAGE);
    expect((await run(['enable', 'stray'])).code).toBe(EXIT_USAGE);
    expect((await run(['enable'])).code).toBe(EXIT_USAGE); // missing --email
    expect((await run(['constructor'])).code).toBe(EXIT_USAGE);
    expect((await run(['__proto__'])).code).toBe(EXIT_USAGE);
  });
});

describe('create-user', () => {
  it('creates a user with a password from stdin and the signup bonus, without printing the password', async () => {
    const result = await run(
      ['create-user', '--email', 'New@Example.com', '--name', 'New One', '--password-stdin'],
      { secrets: [GOOD_PASSWORD] },
    );
    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('new@example.com');
    expect(result.out + result.err).not.toContain(GOOD_PASSWORD);
    const row = userByEmail('new@example.com');
    expect(row).toMatchObject({ name: 'New One', role: 'user', locale: 'ar', creditBalance: 50 });
    expect(row?.passwordHash).toMatch(/^scrypt\$/);
    expect(result.out).not.toContain(row?.passwordHash ?? 'x');
    expectConsistentLedger(harness.db, row?.id ?? '', 0);
    await expect(
      loginUser({ email: 'new@example.com', password: GOOD_PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('creates an admin with a chosen locale and credit amount', async () => {
    const result = await run(
      [
        'create-user',
        '--email',
        'root@example.com',
        '--role',
        'admin',
        '--locale',
        'en',
        '--credits',
        '0',
        '--password-stdin',
      ],
      { secrets: [GOOD_PASSWORD] },
    );
    expect(result.code).toBe(EXIT_OK);
    expect(userByEmail('root@example.com')).toMatchObject({
      role: 'admin',
      locale: 'en',
      creditBalance: 0,
    });
    expect(harness.db.select().from(creditLedger).all()).toHaveLength(0);
  });

  it('reads the password from AIVORE_ADMIN_PASSWORD, or prompts twice and compares', async () => {
    const fromEnv = await run(['create-user', '--email', 'env@example.com'], {
      env: { AIVORE_ADMIN_PASSWORD: GOOD_PASSWORD },
    });
    expect(fromEnv.code).toBe(EXIT_OK);
    expect(fromEnv.prompts).toEqual([]);

    const prompted = await run(['create-user', '--email', 'prompt@example.com'], {
      secrets: [GOOD_PASSWORD, GOOD_PASSWORD],
    });
    expect(prompted.code).toBe(EXIT_OK);
    expect(prompted.prompts).toEqual(['Password: ', 'Repeat password: ']);

    const mismatch = await run(['create-user', '--email', 'mismatch@example.com'], {
      secrets: [GOOD_PASSWORD, 'something else entirely'],
    });
    expect(mismatch.code).toBe(EXIT_FAILED);
    expect(mismatch.err).toMatch(/do not match/);
    expect(userByEmail('mismatch@example.com')).toBeUndefined();
  });

  it('accepts --password but warns about shell history', async () => {
    const result = await run([
      'create-user',
      '--email',
      'arg@example.com',
      '--password',
      GOOD_PASSWORD,
    ]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.err).toMatch(/shell history/);
    expect(result.err).not.toContain(GOOD_PASSWORD);
  });

  it('applies the password policy and reports it (exit 1), creating nothing', async () => {
    const result = await run(['create-user', '--email', 'weak@example.com', '--password-stdin'], {
      secrets: ['password123'],
    });
    expect(result.code).toBe(EXIT_FAILED);
    expect(result.err).toContain('password: Password is too common');
    expect(userByEmail('weak@example.com')).toBeUndefined();
  });

  it('refuses a taken email (exit 1) and a bad role, locale or credits (exit 2)', async () => {
    createUser(harness.db, { email: 'taken@example.com' });
    expect(
      (
        await run(['create-user', '--email', 'taken@example.com', '--password-stdin'], {
          secrets: [GOOD_PASSWORD],
        })
      ).code,
    ).toBe(EXIT_FAILED);
    expect(
      (
        await run(
          ['create-user', '--email', 'a@example.com', '--role', 'root', '--password-stdin'],
          { secrets: [GOOD_PASSWORD] },
        )
      ).code,
    ).toBe(EXIT_USAGE);
    expect(
      (
        await run(
          ['create-user', '--email', 'a@example.com', '--locale', 'fr', '--password-stdin'],
          { secrets: [GOOD_PASSWORD] },
        )
      ).code,
    ).toBe(EXIT_USAGE);
    expect(
      (
        await run(
          ['create-user', '--email', 'a@example.com', '--credits', 'lots', '--password-stdin'],
          { secrets: [GOOD_PASSWORD] },
        )
      ).code,
    ).toBe(EXIT_USAGE);
    expect(userByEmail('a@example.com')).toBeUndefined();
  });
});

describe('grant-credits', () => {
  it('adds credits through the ledger (reason admin_grant, with the note)', async () => {
    const user = createUser(harness.db, { email: 'gift@example.com', creditBalance: 0 });
    const result = await run([
      'grant-credits',
      '--email',
      'GIFT@example.com',
      '--amount',
      '25',
      '--note',
      'launch promo',
    ]);
    expect(result).toMatchObject({ code: EXIT_OK });
    expect(result.out).toContain('Balance: 25');
    expect(userByEmail('gift@example.com')?.creditBalance).toBe(25);
    expect(harness.db.select().from(creditLedger).all()).toMatchObject([
      { userId: user.id, delta: 25, reason: 'admin_grant', note: 'launch promo' },
    ]);
    expectConsistentLedger(harness.db, user.id, 0);
  });

  it('fails for an unknown user (1) and rejects bad amounts (2) without touching balances', async () => {
    const user = createUser(harness.db, { email: 'gift@example.com', creditBalance: 3 });
    expect(
      (await run(['grant-credits', '--email', 'ghost@example.com', '--amount', '5'])).code,
    ).toBe(EXIT_FAILED);
    for (const amount of ['0', '-5', '1.5', 'abc', '2000000000', '']) {
      expect(
        (await run(['grant-credits', '--email', 'gift@example.com', '--amount', amount])).code,
        amount,
      ).toBe(EXIT_USAGE);
    }
    expect((await run(['grant-credits', '--email', 'gift@example.com'])).code).toBe(EXIT_USAGE);
    expect(userByEmail('gift@example.com')?.creditBalance).toBe(user.creditBalance);
  });
});

describe('set-role', () => {
  it('promotes and demotes', async () => {
    createUser(harness.db, { email: 'a@example.com' });
    createUser(harness.db, { email: 'keep-admin@example.com', role: 'admin' });
    expect((await run(['set-role', '--email', 'a@example.com', '--role', 'admin'])).code).toBe(
      EXIT_OK,
    );
    expect(userByEmail('a@example.com')?.role).toBe('admin');
    expect((await run(['set-role', '--email', 'a@example.com', '--role', 'user'])).code).toBe(
      EXIT_OK,
    );
    expect(userByEmail('a@example.com')?.role).toBe('user');
  });

  it('refuses to demote the last active admin unless forced', async () => {
    createUser(harness.db, { email: 'only@example.com', role: 'admin' });
    const refused = await run(['set-role', '--email', 'only@example.com', '--role', 'user']);
    expect(refused.code).toBe(EXIT_FAILED);
    expect(refused.err).toMatch(/last active admin/);
    expect(userByEmail('only@example.com')?.role).toBe('admin');
    expect(
      (await run(['set-role', '--email', 'only@example.com', '--role', 'user', '--force'])).code,
    ).toBe(EXIT_OK);
  });

  it('validates the arguments', async () => {
    createUser(harness.db, { email: 'a@example.com' });
    expect((await run(['set-role', '--email', 'a@example.com'])).code).toBe(EXIT_USAGE);
    expect((await run(['set-role', '--email', 'a@example.com', '--role', 'owner'])).code).toBe(
      EXIT_USAGE,
    );
    expect((await run(['set-role', '--email', 'ghost@example.com', '--role', 'admin'])).code).toBe(
      EXIT_FAILED,
    );
  });
});

describe('disable and enable', () => {
  it('disables an account, ends its sessions, blocks login; enable restores it', async () => {
    const user = createUser(harness.db, { email: 'dis@example.com', passwordHash: fixture.hash });
    const session = createSession(harness.db, user.id);
    const bystander = createUser(harness.db);
    const theirs = createSession(harness.db, bystander.id);

    expect((await run(['disable', '--email', 'dis@example.com'])).code).toBe(EXIT_OK);
    expect(userByEmail('dis@example.com')?.disabledAt).toBeTypeOf('number');
    expect(
      harness.db.select().from(sessions).where(eq(sessions.userId, user.id)).all(),
    ).toHaveLength(0);
    expect(resolveSession(session.token, harness.db)).toBeNull();
    expect(resolveSession(theirs.token, harness.db)).not.toBeNull();
    await expect(
      loginUser({ email: 'dis@example.com', password: GOOD_PASSWORD }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    expect((await run(['enable', '--email', 'dis@example.com'])).code).toBe(EXIT_OK);
    expect(userByEmail('dis@example.com')?.disabledAt).toBeNull();
    await expect(
      loginUser({ email: 'dis@example.com', password: GOOD_PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('will not disable the last active admin without --force', async () => {
    createUser(harness.db, { email: 'only@example.com', role: 'admin' });
    expect((await run(['disable', '--email', 'only@example.com'])).code).toBe(EXIT_FAILED);
    expect(userByEmail('only@example.com')?.disabledAt).toBeNull();
    expect((await run(['disable', '--email', 'only@example.com', '--force'])).code).toBe(EXIT_OK);
  });

  it('fails for unknown users', async () => {
    expect((await run(['disable', '--email', 'ghost@example.com'])).code).toBe(EXIT_FAILED);
    expect((await run(['enable', '--email', 'ghost@example.com'])).code).toBe(EXIT_FAILED);
  });
});

describe('reset-password', () => {
  it('sets a new password and signs the user out everywhere', async () => {
    const user = createUser(harness.db, { email: 'reset@example.com', passwordHash: fixture.hash });
    const session = createSession(harness.db, user.id);
    const result = await run(
      ['reset-password', '--email', 'reset@example.com', '--password-stdin'],
      { secrets: ['a fresh passphrase 99', 'a fresh passphrase 99'] },
    );
    expect(result.code).toBe(EXIT_OK);
    expect(result.out + result.err).not.toContain('a fresh passphrase 99');
    expect(resolveSession(session.token, harness.db)).toBeNull();
    await expect(
      loginUser({ email: 'reset@example.com', password: GOOD_PASSWORD }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      loginUser({ email: 'reset@example.com', password: 'a fresh passphrase 99' }),
    ).resolves.toBeDefined();
  });

  it('applies the policy and leaves the old password alone when it fails', async () => {
    const user = createUser(harness.db, { email: 'reset@example.com', passwordHash: fixture.hash });
    const result = await run(
      ['reset-password', '--email', 'reset@example.com', '--password-stdin'],
      { secrets: ['12345678'] },
    );
    expect(result.code).toBe(EXIT_FAILED);
    expect(userByEmail('reset@example.com')?.passwordHash).toBe(user.passwordHash);
    expect(
      (
        await run(['reset-password', '--email', 'ghost@example.com', '--password-stdin'], {
          secrets: [GOOD_PASSWORD],
        })
      ).code,
    ).toBe(EXIT_FAILED);
  });
});

describe('list-users', () => {
  it('lists newest first with role, credits and status, and never a hash', async () => {
    createUser(harness.db, { email: 'old@example.com', createdAt: 1_000, creditBalance: 1 });
    const dis = createUser(harness.db, {
      email: 'dis@example.com',
      createdAt: 2_000,
      role: 'admin',
      creditBalance: 9,
      disabledAt: 5,
    });
    const result = await run(['list-users']);
    expect(result.code).toBe(EXIT_OK);
    const lines = result.out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('dis@example.com');
    expect(lines[0]).toContain(dis.id);
    expect(lines[0]).toContain('admin');
    expect(lines[0]).toContain('9 credits');
    expect(lines[0]).toContain('disabled');
    expect(lines[1]).toContain('active');
    expect(result.out).not.toMatch(/not-a-real-hash|scrypt|passwordHash/);
  });

  it('prints JSON with --json and says so when there is nobody', async () => {
    expect((await run(['list-users'])).out).toBe('No users found.');
    createUser(harness.db, { email: 'j@example.com' });
    const parsed = JSON.parse((await run(['list-users', '--json'])).out) as Array<
      Record<string, unknown>
    >;
    expect(parsed).toHaveLength(1);
    expect(Object.keys(parsed[0] ?? {}).sort()).toEqual([
      'createdAt',
      'credits',
      'email',
      'id',
      'name',
      'role',
      'status',
    ]);
  });

  it('searches by email or name, treating % and _ literally, and honours --limit', async () => {
    createUser(harness.db, { email: 'alpha@example.com', name: 'Alpha' });
    createUser(harness.db, { email: 'beta@example.com', name: '100% Beta' });
    createUser(harness.db, { email: 'gamma_x@example.com', name: 'Gamma' });
    createUser(harness.db, { email: 'gammaYx@example.com', name: 'Other' });

    expect((await run(['list-users', '--search', 'ALPHA'])).out).toContain('alpha@example.com');
    expect((await run(['list-users', '--search', '100%'])).out).toContain('beta@example.com');
    const percent = (await run(['list-users', '--search', '%'])).out.split('\n');
    expect(percent).toHaveLength(1); // only the name that contains a literal percent sign
    const underscore = (await run(['list-users', '--search', 'gamma_x'])).out.split('\n');
    expect(underscore).toHaveLength(1);
    expect(underscore[0]).toContain('gamma_x@example.com');
    expect((await run(['list-users', '--limit', '2'])).out.split('\n')).toHaveLength(2);
    expect((await run(['list-users', '--limit', '0'])).code).toBe(EXIT_USAGE);
    expect((await run(['list-users', '--limit', '5000'])).code).toBe(EXIT_USAGE);
    expect((await run(['list-users', '--limit', 'x'])).code).toBe(EXIT_USAGE);
  });
});

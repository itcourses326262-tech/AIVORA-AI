import { describe, expect, it, vi } from 'vitest';
import type { CreateApiKeyResponse, LedgerEntryDTO, UserDTO } from '@/lib/api-types';
import { EXIT_FAILED, EXIT_OK, runAdminCli } from '@/server/auth/admin/cli';
import type { CliIo } from '@/server/auth/admin/io';
import { expectConsistentLedger } from '../helpers/credits';
import { Client, dataOf, errorOf } from './helpers/api';
import { createWorld, textToVideo, type Member } from './helpers/world';

// What an operator does with `npm run admin` (grant credits, disable, reset a password) must show
// up in the live API at once: balances, ledger, sessions and keys all follow the same database.

vi.setConfig({ testTimeout: 60_000 });

const world = createWorld();

function operator(
  secret = 'Operator-chosen-passphrase-5',
): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (line) => void stdout.push(line),
    err: (line) => void stderr.push(line),
    readSecret: async () => secret,
    env: () => undefined,
  };
}

async function admin(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const io = operator();
  const code = await runAdminCli(args, io);
  return { code, stdout: io.stdout.join('\n'), stderr: io.stderr.join('\n') };
}

const balanceOf = async (member: Client) =>
  dataOf(await member.get<UserDTO>('/auth/me')).creditBalance;

describe('operator commands against the live API', () => {
  it('a granted balance is spendable at once and appears in the user’s ledger', async () => {
    const alice = await world.signUp('Alice');
    expect(
      (await admin('grant-credits', '--email', alice.email, '--amount', '100', '--note', 'support'))
        .code,
    ).toBe(EXIT_OK);
    expect(await balanceOf(alice)).toBe(150);

    const ledger = dataOf(await alice.get<LedgerEntryDTO[]>('/account/ledger'));
    expect(ledger[0]).toMatchObject({
      reason: 'admin_grant',
      delta: 100,
      balanceAfter: 150,
      note: 'support',
    });

    // 150 credits buy ten 15-credit clips, which 50 could not.
    for (let clip = 0; clip < 3; clip += 1) {
      const reply = await alice.post(
        '/generations',
        textToVideo('waves', { params: { durationSec: 5, resolution: '720p' } }),
      );
      expect(reply.status).toBe(201);
    }
    expect(await balanceOf(alice)).toBe(105);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('refuses nonsense amounts and unknown users without touching any balance', async () => {
    const alice = await world.signUp('Alice');
    for (const amount of ['0', '-5', '1.5', 'many', '1000000001']) {
      const result = await admin('grant-credits', '--email', alice.email, '--amount', amount);
      expect(result.code, amount).not.toBe(EXIT_OK);
    }
    expect(
      (await admin('grant-credits', '--email', 'nobody@example.com', '--amount', '5')).code,
    ).toBe(EXIT_FAILED);
    expect(await balanceOf(alice)).toBe(50);
  });

  it('creates an admin who can sign in through the API, with the credits and role given', async () => {
    const created = await admin(
      'create-user',
      '--email',
      'Ops@Example.com',
      '--name',
      'Ops',
      '--role',
      'admin',
      '--credits',
      '200',
    );
    expect(created.code, created.stderr).toBe(EXIT_OK);

    const login = await new Client().post<UserDTO>('/auth/login', {
      email: 'ops@example.com',
      password: 'Operator-chosen-passphrase-5',
    });
    const ops = dataOf(login);
    expect(ops).toMatchObject({ email: 'ops@example.com', role: 'admin', creditBalance: 200 });
    expect(JSON.stringify(created)).not.toContain('Operator-chosen-passphrase-5');
  });

  it('disabling an account ends its sessions and keys at once, and enabling restores access', async () => {
    const alice = await world.signUp('Alice');
    const key = dataOf(await alice.post<CreateApiKeyResponse>('/keys', { name: 'ci' }), 201);
    const script = new Client({ apiKey: key.key });
    expect((await script.get('/generations')).status).toBe(200);
    expect((await alice.get('/generations')).status).toBe(200);

    expect((await admin('disable', '--email', alice.email)).code).toBe(EXIT_OK);
    expect(errorOf(await alice.get('/generations'), 401)).toBe('unauthorized');
    expect(errorOf(await script.get('/generations'), 401)).toBe('unauthorized');
    const blocked = await new Client().post('/auth/login', {
      email: alice.email,
      password: alice.password,
    });
    expect(blocked.status).toBe(403);

    expect((await admin('enable', '--email', alice.email)).code).toBe(EXIT_OK);
    // The old browser session was ended by `disable` and stays ended; a new login works, and the
    // key (which was only switched off with the account, not revoked) works again.
    expect(errorOf(await alice.get('/generations'), 401)).toBe('unauthorized');
    const back = await new Client().post<UserDTO>('/auth/login', {
      email: alice.email,
      password: alice.password,
    });
    expect(dataOf(back).id).toBe(alice.user.id);
    expect((await script.get('/generations')).status).toBe(200);
  });

  it('resetting a password signs the user out everywhere and the new password works', async () => {
    const alice: Member = await world.signUp('Alice');
    const result = await admin('reset-password', '--email', alice.email);
    expect(result.code, result.stderr).toBe(EXIT_OK);

    expect(errorOf(await alice.get('/generations'), 401)).toBe('unauthorized');
    const old = await new Client().post('/auth/login', {
      email: alice.email,
      password: alice.password,
    });
    expect(errorOf(old, 401)).toBe('unauthorized');
    const fresh = await new Client().post<UserDTO>('/auth/login', {
      email: alice.email,
      password: 'Operator-chosen-passphrase-5',
    });
    expect(dataOf(fresh).id).toBe(alice.user.id);
  });
});

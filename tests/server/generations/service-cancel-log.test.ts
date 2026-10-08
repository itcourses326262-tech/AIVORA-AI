import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBalance } from '@/server/credits';
import { cancelGeneration, deleteGeneration } from '@/server/generations/service';
import { resetEnvForTests } from '@/server/env';
import { resetLoggerForTests } from '@/server/logger';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';
import { queue } from './support';

// A cancel refunds in full even after the provider accepted the job (section 8). That policy is
// unchanged; these tests pin the signal operators alert on: one log line per such cancel, with ids
// only, and none for cancels that cost the provider nothing.

const harness = freshDb();
const MESSAGE = 'Canceled a generation after it was submitted to the provider';

let lines: Array<Record<string, unknown>>;

beforeEach(() => {
  lines = [];
  vi.stubEnv('LOG_LEVEL', 'info');
  resetEnvForTests();
  resetLoggerForTests();
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim().startsWith('{')) lines.push(JSON.parse(line) as Record<string, unknown>);
    }
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvForTests();
  resetLoggerForTests();
});

const alerts = () => lines.filter((line) => line.msg === MESSAGE);

function processing(userId: string, overrides: Parameters<typeof queue>[2] = {}) {
  return queue(
    harness.db,
    { id: userId },
    {
      status: 'processing',
      workerId: 'w1',
      leaseUntil: Date.now() + 60_000,
      attempts: 1,
      prompt: 'a secret prompt nobody should see in logs',
      cost: 4,
      ...overrides,
    },
  );
}

describe('canceling a generation the provider already accepted', () => {
  it('still refunds in full, and logs it once with ids and no prompt', async () => {
    const user = createUser(harness.db);
    const row = processing(user.id, { providerJobId: 'remote-1' });
    await cancelGeneration(user.id, row.id);

    expect(getBalance(harness.db, user.id)).toBe(50);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toMatchObject({
      level: 'info',
      component: 'generations',
      generationId: row.id,
      userId: user.id,
      modelId: row.modelId,
      provider: row.provider,
      cost: 4,
    });
    const everything = JSON.stringify(lines);
    expect(everything).not.toContain('secret prompt');
    expect(everything).not.toContain('remote-1');
  });

  it('logs nothing for a cancel that cost the provider nothing', async () => {
    const user = createUser(harness.db);
    await cancelGeneration(user.id, queue(harness.db, user).id); // queued
    const unsubmitted = processing(user.id); // a worker has it, but nothing was submitted yet
    await cancelGeneration(user.id, unsubmitted.id);
    expect(alerts()).toEqual([]);
  });

  it('does not log again when the cancel is repeated, or when it was refused', async () => {
    const user = createUser(harness.db);
    const row = processing(user.id, { providerJobId: 'remote-1' });
    await cancelGeneration(user.id, row.id);
    await cancelGeneration(user.id, row.id);
    const done = queue(harness.db, user, { status: 'succeeded', providerJobId: 'remote-2' });
    await expect(cancelGeneration(user.id, done.id)).rejects.toMatchObject({ code: 'conflict' });
    expect(alerts()).toHaveLength(1);
  });

  it('logs it when deleting such a generation cancels it, too', async () => {
    const user = createUser(harness.db);
    const row = processing(user.id, { providerJobId: 'remote-1' });
    await deleteGeneration(user.id, row.id);
    expect(getBalance(harness.db, user.id)).toBe(50);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toMatchObject({ generationId: row.id });

    const finished = queue(harness.db, user, { status: 'succeeded', providerJobId: 'remote-2' });
    await deleteGeneration(user.id, finished.id);
    expect(alerts()).toHaveLength(1); // deleting a finished one cancels nothing
  });
});

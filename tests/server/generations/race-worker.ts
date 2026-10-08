// Child process used by tests/server/generations/race.test.ts. It opens its OWN connection to the
// shared database file, waits until `startAt` so every process starts together, runs one of the
// lifecycle operations in a loop and prints what it achieved as JSON on the last stdout line.
//
//   claim    <db> <startAt> <tag>                    claim jobs until the queue is empty
//   complete <db> <startAt> <tag> <genId> <worker>   completeGeneration once
//   cancel   <db> <startAt> <tag> <genId> <userId>   markCanceled once
//   fail     <db> <startAt> <tag> <genId> <worker>   failGeneration once ("-" = no worker)
//   requeue  <db> <startAt> <tag> <now>              requeueStale once
import { newId } from '@/lib/id';
import { createDb } from '@/server/db';
import {
  claimNextJob,
  completeGeneration,
  failGeneration,
  markCanceled,
  requeueStale,
} from '@/server/generations/lifecycle';

const LEASE_MS = 60_000;

/** Blocks (without burning CPU) until `epochMs`, so all processes start together. */
function sleepUntil(epochMs: number): void {
  for (let remaining = epochMs - Date.now(); remaining > 0; remaining = epochMs - Date.now()) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, remaining);
  }
}

const [mode, path, startAt, tag, arg1, arg2] = process.argv.slice(2);
if (!mode || !path || !startAt || !tag) {
  throw new Error('usage: race-worker <mode> <db> <startAt> <tag> [args]');
}

const db = createDb(path);
sleepUntil(Number(startAt));

function report(result: Record<string, unknown>): void {
  db.$client.close();
  console.log(JSON.stringify(result));
}

if (mode === 'claim') {
  const claimed: string[] = [];
  for (;;) {
    const job = claimNextJob(db, `worker-${tag}`, LEASE_MS, Date.now(), { maxAttempts: 3 });
    if (!job) break;
    claimed.push(job.id);
  }
  report({ claimed });
} else if (mode === 'complete') {
  const assetId = newId('ast');
  const won = completeGeneration(db, arg1 ?? '', arg2 ?? '', [
    {
      assetId,
      index: 0,
      kind: 'image',
      storageKey: `u/usr_race/${arg1}/${assetId}.png`,
      mimeType: 'image/png',
      bytes: 10,
    },
  ]);
  report({ won });
} else if (mode === 'cancel') {
  report({ won: markCanceled(db, arg2 ?? '', arg1 ?? '') });
} else if (mode === 'fail') {
  const worker = arg2 === '-' ? null : (arg2 ?? null);
  report({ won: failGeneration(db, arg1 ?? '', worker, { code: 'internal', message: 'boom' }) });
} else if (mode === 'requeue') {
  report({ touched: requeueStale(db, Number(arg1), { maxAttempts: 3 }) });
} else {
  throw new Error(`unknown mode ${mode}`);
}

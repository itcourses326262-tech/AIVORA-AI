// Child process used by tests/server/generations/race.test.ts. It opens its OWN connection to the
// shared database file, waits at the start barrier (see barrier.ts) until every process is ready,
// runs one of the lifecycle operations and prints what it achieved as JSON on the last stdout line.
//
//   claim    <db> <barrierDir> <tag> [max]            claim jobs until the queue is empty or `max` are taken
//   complete <db> <barrierDir> <tag> <genId> <worker> completeGeneration once
//   cancel   <db> <barrierDir> <tag> <genId> <userId> markCanceled once
//   fail     <db> <barrierDir> <tag> <genId> <worker> failGeneration once ("-" = no worker)
//   requeue  <db> <barrierDir> <tag> <now>            requeueStale once
import { newId } from '@/lib/id';
import { createDb } from '@/server/db';
import {
  claimNextJob,
  completeGeneration,
  failGeneration,
  markCanceled,
  requeueStale,
} from '@/server/generations/lifecycle';
import { waitAtBarrier } from './barrier';

const LEASE_MS = 60_000;

const [mode, path, barrierDir, tag, arg1, arg2] = process.argv.slice(2);
if (!mode || !path || !barrierDir || !tag) {
  throw new Error('usage: race-worker <mode> <db> <barrierDir> <tag> [args]');
}

const db = createDb(path);
waitAtBarrier(barrierDir, tag);

function report(result: Record<string, unknown>): void {
  db.$client.close();
  console.log(JSON.stringify(result));
}

if (mode === 'claim') {
  const claimed: string[] = [];
  const max = arg1 === undefined ? Infinity : Number(arg1);
  while (claimed.length < max) {
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

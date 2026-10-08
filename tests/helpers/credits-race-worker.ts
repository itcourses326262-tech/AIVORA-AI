// Child process used by tests/server/credits/race.test.ts. It opens its OWN connection to the
// shared database file, waits until `startAt` so every process starts together, then hammers the
// credits API and prints the tallies as JSON.
//
//   debit  <db> <userId> <attempts> <startAt> <tag>             debit 1 credit per attempt
//   refund <db> <userId> <attempts> <startAt> <tag> <genId>     refund <genId> per attempt
import { AppError } from '@/lib/errors';
import { debitCredits, refundGeneration } from '@/server/credits';
import { createDb } from '@/server/db';

/** Blocks (without burning CPU) until `epochMs`, so all processes start together. */
function sleepUntil(epochMs: number): void {
  for (let remaining = epochMs - Date.now(); remaining > 0; remaining = epochMs - Date.now()) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, remaining);
  }
}

const [mode, path, userId, attempts, startAt, tag, generationId] = process.argv.slice(2);
if (!mode || !path || !userId || !attempts || !startAt || !tag) {
  throw new Error(
    'usage: credits-race-worker <debit|refund> <db> <userId> <attempts> <startAt> <tag> [genId]',
  );
}

const db = createDb(path);
sleepUntil(Number(startAt));

let succeeded = 0;
let rejected = 0;
let other = 0;
for (let attempt = 0; attempt < Number(attempts); attempt++) {
  try {
    if (mode === 'debit') {
      debitCredits(db, { userId, amount: 1, generationId: `gen_race_${tag}_${attempt}` });
      succeeded += 1;
    } else if (refundGeneration(db, generationId ?? '')) {
      succeeded += 1;
    } else {
      rejected += 1;
    }
  } catch (error) {
    if (error instanceof AppError && error.code === 'insufficient_credits') rejected += 1;
    else {
      other += 1;
      console.error(error);
    }
  }
}
db.$client.close();
console.log(JSON.stringify({ succeeded, rejected, other }));

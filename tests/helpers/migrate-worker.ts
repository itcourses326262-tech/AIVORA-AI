// Child process used by tests/server/db/migrate.test.ts: opens the database at argv[2] and runs
// the migrations once `startAt` (argv[3], epoch ms) has passed, then prints the result as JSON.
import { createDb } from '@/server/db';
import { runMigrations } from '@/server/db/migrate';

/** Blocks (without burning CPU) until `epochMs`, so all processes start together. */
function sleepUntil(epochMs: number): void {
  for (let remaining = epochMs - Date.now(); remaining > 0; remaining = epochMs - Date.now()) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, remaining);
  }
}

const [path, startAt] = process.argv.slice(2);
if (!path || !startAt) throw new Error('usage: migrate-worker <dbPath> <startAtMs>');

const db = createDb(path);
sleepUntil(Number(startAt));
const result = runMigrations(db);
db.$client.close();
console.log(JSON.stringify(result));

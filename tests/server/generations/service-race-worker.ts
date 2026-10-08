// Child process used by tests/server/generations/service-race.test.ts. It runs the real
// `createGeneration` against the shared database file (DATABASE_PATH comes from the parent) and
// prints how its attempts ended.
//
//   service-race-worker <startAt> <userId> <attempts> <same|distinct> <tag>
import { AppError } from '@/lib/errors';
import { createGeneration } from '@/server/generations/service';

function sleepUntil(epochMs: number): void {
  for (let remaining = epochMs - Date.now(); remaining > 0; remaining = epochMs - Date.now()) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, remaining);
  }
}

const [startAt, userId, attempts, keyMode, tag] = process.argv.slice(2);
if (!startAt || !userId || !attempts || !keyMode || !tag) {
  throw new Error('usage: service-race-worker <startAt> <userId> <attempts> <same|distinct> <tag>');
}

sleepUntil(Number(startAt));
const tally: Record<string, number> = {};
const bump = (name: string) => {
  tally[name] = (tally[name] ?? 0) + 1;
};

for (let attempt = 0; attempt < Number(attempts); attempt += 1) {
  try {
    const { created } = await createGeneration(
      userId,
      {
        tool: 'text-to-image',
        modelId: 'aivore-demo-image',
        prompt: keyMode === 'same' ? 'one shared prompt' : `prompt ${tag} ${attempt}`,
      },
      { idempotencyKey: keyMode === 'same' ? 'shared-key' : `${tag}-${attempt}` },
    );
    bump(created ? 'created' : 'replayed');
  } catch (error) {
    if (error instanceof AppError) bump(error.code);
    else {
      bump('other');
      console.error(error);
    }
  }
}
console.log(JSON.stringify(tally));

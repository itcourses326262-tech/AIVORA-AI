// A start barrier for tests that race several child processes. A fixed "start at <timestamp>" is
// fragile: on a loaded machine a child can take longer than the margin to boot, and the others
// finish their work before it even opens the database, so nothing is raced at all. Here each
// child announces that it is ready and waits; the parent releases them together once ALL of them
// are, however long that takes.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const READY_TIMEOUT_MS = 60_000;

/** Child side: say "ready" and block (without burning CPU) until the parent says "go". */
export function waitAtBarrier(dir: string, tag: string): void {
  writeFileSync(join(dir, `ready-${tag}`), '');
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const giveUpAt = Date.now() + READY_TIMEOUT_MS;
  while (!existsSync(join(dir, 'go'))) {
    if (Date.now() > giveUpAt) throw new Error('the barrier was never released');
    Atomics.wait(sleeper, 0, 0, 2);
  }
}

/**
 * Parent side: waits until `count` children are ready, then releases them all at once. Rejects as
 * soon as one of `children` fails before that (a crashed child would otherwise leave us waiting).
 */
export async function releaseWhenReady(
  dir: string,
  count: number,
  children: Array<Promise<unknown>>,
): Promise<void> {
  let failure: { error: unknown } | undefined;
  for (const child of children) {
    child.catch((error: unknown) => {
      failure ??= { error };
    });
  }
  const ready = () => readdirSync(dir).filter((name) => name.startsWith('ready-')).length;
  const giveUpAt = Date.now() + READY_TIMEOUT_MS;
  while (ready() < count) {
    if (failure) throw failure.error;
    if (Date.now() > giveUpAt) throw new Error('not every child became ready');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  writeFileSync(join(dir, 'go'), '');
}

import 'server-only';
import { getLogger } from '@/server/logger';

/**
 * Work that must not delay (or reveal anything through) the response of a request: the password
 * reset lookup and its email. It runs on a later turn of the event loop, a failure is logged and
 * never reaches the client, and {@link flushBackground} lets tests and scripts wait for it.
 */
const pending = new Set<Promise<void>>();

export function runInBackground(label: string, work: () => void | Promise<void>): void {
  const task = new Promise<void>((resolve) => {
    setImmediate(() => {
      Promise.resolve()
        .then(work)
        .catch((err: unknown) => {
          getLogger().error('Background task failed', { component: 'auth', task: label, err });
        })
        .finally(resolve);
    });
  });
  pending.add(task);
  void task.finally(() => pending.delete(task));
}

export async function flushBackground(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}

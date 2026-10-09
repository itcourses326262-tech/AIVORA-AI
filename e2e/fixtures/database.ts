import Database from 'better-sqlite3';
import { join } from 'node:path';
import { newId } from '@/lib/id';

/**
 * Direct access to the scratch database of the server under test (`aivore.db` in the run's scratch
 * directory), for the few things a browser cannot set up: states the production server refuses to
 * create. Every call opens and closes its own connection; the server keeps working in WAL mode.
 */
function withDatabase<T>(run: (db: Database.Database) => T): T {
  const dir = process.env.AIVORE_E2E_DIR;
  if (!dir) throw new Error('AIVORE_E2E_DIR is not set: run through playwright.config.ts');
  const db = new Database(join(dir, 'aivore.db'), { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 10000');
    return run(db);
  } finally {
    db.close();
  }
}

/**
 * A pending order made with the FAKE payment gateway for `userId`. The production server cannot
 * create one (billing is off there and the fake gateway is refused outright), so this is the only
 * way to ask the fake checkout page about an order that really exists. Returns the order id.
 */
export function insertMockOrder(userId: string): string {
  const id = newId('ord');
  const now = Date.now();
  withDatabase((db) =>
    db
      .prepare(
        `INSERT INTO orders
           (id, user_id, kind, item_id, amount_halalas, currency, vat_halalas, credits, status,
            gateway, created_at, updated_at)
         VALUES (?, ?, 'pack', 'pack-500', 5000, 'SAR', 652, 500, 'pending', 'mock', ?, ?)`,
      )
      .run(id, userId, now, now),
  );
  return id;
}

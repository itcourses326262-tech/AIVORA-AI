import { createDb } from '@/server/db';
import { runMigrations } from '@/server/db/migrate';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logger';

// `npm run db:migrate`: applies pending migrations to DATABASE_PATH and exits.
const log = getLogger();

try {
  const { DATABASE_PATH } = getEnv();
  const db = createDb(DATABASE_PATH);
  try {
    const { applied, total } = runMigrations(db);
    log.info('Database migrations complete', { databasePath: DATABASE_PATH, applied, total });
  } finally {
    db.$client.close();
  }
} catch (error) {
  log.error('Database migration failed', { err: error });
  process.exitCode = 1;
}

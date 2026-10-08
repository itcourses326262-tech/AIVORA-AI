import 'server-only';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { withTx, type Db } from './tx';

export interface MigrateOptions {
  /** Folder holding drizzle-kit's `meta/_journal.json` and SQL files. Defaults to `<cwd>/drizzle`. */
  migrationsFolder?: string;
}

export interface MigrateResult {
  applied: number;
  total: number;
}

const MIGRATIONS_TABLE = '__drizzle_migrations';

export function defaultMigrationsFolder(): string {
  return join(process.cwd(), 'drizzle');
}

/**
 * Applies every pending migration inside one `BEGIN IMMEDIATE` transaction and records it in the
 * same `__drizzle_migrations` table drizzle-kit uses. Idempotent, and safe when several processes
 * (web server, worker, `npm run db:migrate`) start against a fresh database at once: the lock is
 * taken before the applied set is read, so exactly one of them does the work.
 */
export function runMigrations(db: Db, options: MigrateOptions = {}): MigrateResult {
  const migrations = readMigrationFiles({
    migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder(),
  });

  return withTx(db, (tx) => {
    tx.run(sql`
      CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_TABLE)} (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )
    `);
    const last = tx.get<{ created_at: string | number } | undefined>(
      sql`SELECT created_at FROM ${sql.identifier(MIGRATIONS_TABLE)} ORDER BY created_at DESC LIMIT 1`,
    );
    const lastApplied = last ? Number(last.created_at) : -Infinity;

    let applied = 0;
    for (const migration of migrations) {
      if (migration.folderMillis <= lastApplied) continue;
      for (const statement of migration.sql) tx.run(sql.raw(statement));
      tx.run(
        sql`INSERT INTO ${sql.identifier(MIGRATIONS_TABLE)} ("hash", "created_at") VALUES (${migration.hash}, ${migration.folderMillis})`,
      );
      applied += 1;
    }
    return { applied, total: migrations.length };
  });
}

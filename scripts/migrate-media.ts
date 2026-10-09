// `npm run migrate:media -- [--apply] [--concurrency n]`: copies every picture and video from the
// local media folder (STORAGE_LOCAL_DIR) to the storage configured for the site (STORAGE_DRIVER=gcs
// or s3), under the same keys. Without --apply it only counts. Local files are never deleted, and
// the command can be run again after any interruption: what is already there is skipped.
import { existsSync } from 'node:fs';
import { createDb } from '@/server/db';
import { assets as assetsTable } from '@/server/db/schema';
import { getEnv } from '@/server/env';
import { getStorage } from '@/server/storage';
import { createLocalStorage } from '@/server/storage/local';
import {
  MIGRATE_USAGE,
  migrateMedia,
  parseMigrateArgs,
  summaryLines,
  type AssetRef,
} from './lib/migrate-media';

/** The files the database knows, for their content types. A missing database is not an error. */
function readAssets(databasePath: string): { assets: AssetRef[]; note?: string } {
  if (databasePath === ':memory:' || !existsSync(databasePath)) {
    return { assets: [], note: 'No database file found: content types come from the files.' };
  }
  const db = createDb(databasePath);
  try {
    const rows = db
      .select({
        storageKey: assetsTable.storageKey,
        thumbKey: assetsTable.thumbKey,
        mimeType: assetsTable.mimeType,
      })
      .from(assetsTable)
      .all();
    return { assets: rows };
  } catch {
    return { assets: [], note: 'The database has no assets table yet (run npm run db:migrate).' };
  } finally {
    db.$client.close();
  }
}

async function main(): Promise<number> {
  const args = parseMigrateArgs(process.argv.slice(2));
  if ('error' in args) {
    console.log(`${args.error}\n${MIGRATE_USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(MIGRATE_USAGE);
    return 0;
  }

  const env = getEnv();
  if (env.STORAGE_DRIVER === 'local') {
    console.log(
      'STORAGE_DRIVER is local, so there is nowhere to copy to.\n' +
        'Set the destination first (for Firebase: npm run setup:firebase, then STORAGE_DRIVER=gcs), then run this again.',
    );
    return 1;
  }

  console.log(`AIVORE: move media from ${env.STORAGE_LOCAL_DIR} to ${env.STORAGE_DRIVER}\n`);
  console.log(
    args.apply
      ? 'Copying. Local files are never deleted. Safe to stop and run again.'
      : 'DRY RUN: nothing is copied. Add --apply to copy.',
  );
  const { assets, note } = readAssets(env.DATABASE_PATH);
  if (note) console.log(note);

  const secrets = [
    env.S3_SECRET_ACCESS_KEY,
    env.S3_ACCESS_KEY_ID,
    env.FIREBASE_SERVICE_ACCOUNT_JSON,
  ].filter((value): value is string => Boolean(value));
  const summary = await migrateMedia({
    sourceDir: env.STORAGE_LOCAL_DIR,
    source: createLocalStorage(env.STORAGE_LOCAL_DIR),
    remote: getStorage(),
    assets,
    apply: args.apply,
    concurrency: args.concurrency,
    say: (line) => console.log(line),
    secrets,
  });
  for (const line of summaryLines(summary)) console.log(line);

  if (summary.failed.length > 0 || summary.notAttempted > 0) {
    console.log('\nNot everything was copied. Fix the cause above and run the command again.');
    return 1;
  }
  if (!args.apply && summary.toCopy.objects > 0) {
    console.log(
      `\nDry run finished: ${String(summary.toCopy.objects)} files still need copying. Run: npm run migrate:media -- --apply`,
    );
  } else if (args.apply) {
    console.log(
      '\nDone. The local files are still on disk; delete them yourself once you have checked the site.',
    );
  } else {
    console.log('\nNothing to copy.');
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);

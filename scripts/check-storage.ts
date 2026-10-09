// `npm run check:storage`: one write / read / range / delete round trip through the storage driver
// configured in `.env` / `.env.local` (STORAGE_DRIVER: local, s3 or gcs). Prints what failed and
// what to do about it; never prints a credential.
import { getEnv } from '@/server/env';
import { readServiceAccount } from '@/server/storage/gcs-credentials';
import { getStorage } from '@/server/storage';
import { adviceFor, runStorageCheck, scrubSecrets, type CheckTarget } from './lib/storage-check';

function describeTarget(env: ReturnType<typeof getEnv>): {
  target: CheckTarget;
  secrets: string[];
} {
  const secrets = [
    env.S3_SECRET_ACCESS_KEY,
    env.S3_ACCESS_KEY_ID,
    env.FIREBASE_SERVICE_ACCOUNT_JSON,
  ].filter((value): value is string => Boolean(value));
  if (env.STORAGE_DRIVER === 'gcs') {
    const target: CheckTarget = { driver: 'gcs', where: env.FIREBASE_STORAGE_BUCKET ?? '' };
    try {
      const account = readServiceAccount(env);
      target.serviceAccountEmail = account.client_email;
      secrets.push(account.private_key);
    } catch {
      // Reported properly when the driver is created below.
    }
    return { target, secrets };
  }
  if (env.STORAGE_DRIVER === 's3') {
    return { target: { driver: 's3', where: env.S3_BUCKET ?? '' }, secrets };
  }
  return { target: { driver: 'local', where: env.STORAGE_LOCAL_DIR }, secrets };
}

async function main(): Promise<number> {
  console.log('AIVORE: check file storage\n');
  let env;
  try {
    env = getEnv();
  } catch (error) {
    console.log(
      `The settings are not valid:\n${error instanceof Error ? error.message : String(error)}`,
    );
    console.log('\nFix them in .env.local (for Firebase storage: npm run setup:firebase).');
    return 1;
  }
  const { target, secrets } = describeTarget(env);
  const where = target.where
    ? ` (${target.driver === 'local' ? 'folder' : 'bucket'} ${target.where})`
    : '';
  console.log(`Driver: ${target.driver}${where}`);
  if (target.serviceAccountEmail) console.log(`Service account: ${target.serviceAccountEmail}`);
  console.log('');

  let storage;
  try {
    storage = getStorage();
  } catch (error) {
    const { reason, advice } = adviceFor(error, target);
    const detail = error instanceof Error ? error.message : String(error);
    console.log(scrubSecrets(`FAILED (${reason}): ${detail}\n${advice}`, secrets));
    return 1;
  }

  const result = await runStorageCheck({ storage, target, secrets });
  if (result.ok) {
    console.log(`\nOK: storage works (${String(result.totalMs)} ms in total).`);
    if (target.driver === 'local') {
      console.log(
        'This is the local disk. To use your Firebase bucket instead: npm run setup:firebase',
      );
    }
    return 0;
  }
  console.log(`\nFAILED at "${result.step}" (${result.reason}): ${result.advice}`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);

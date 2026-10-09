// Shared by `npm run check:storage`: one write/read/range/delete round trip through the configured
// StorageDriver, and plain-English advice for each way it can fail. Nothing here prints a
// credential: every line goes through `scrubSecrets` first.
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isAppError } from '@/lib/errors';
import type { StorageDriver } from '@/server/storage/types';

export type StorageDriverName = 'local' | 's3' | 'gcs';

export type StorageFailure =
  | 'config'
  | 'permission'
  | 'bucket'
  | 'network'
  | 'auth'
  | 'timeout'
  | 'disk'
  | 'integrity'
  | 'unknown';

export interface CheckTarget {
  driver: StorageDriverName;
  /** Bucket name (s3, gcs) or directory (local): shown in advice. Not secret. */
  where?: string;
  /** The identity that needs the bucket role (gcs). Not secret. */
  serviceAccountEmail?: string;
}

export interface CheckStep {
  step: string;
  ms: number;
}

export type StorageCheckResult =
  | { ok: true; steps: CheckStep[]; totalMs: number }
  | { ok: false; step: string; reason: StorageFailure; advice: string };

/** The driver answered, but not with what was written: nothing to do with the network. */
export class StorageMismatchError extends Error {
  override readonly name: string = 'StorageMismatchError';
}

const PEM_BLOCK = /-----BEGIN [A-Z ]+-----[\s\S]*?(?:-----END [A-Z ]+-----|$)/g;
const LONG_TOKEN = /[A-Za-z0-9+=_-]{100,}/g;

/** Removes private-key blocks, long base64-like runs and every listed literal from `text`. */
export function scrubSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(PEM_BLOCK, '[hidden]').replace(LONG_TOKEN, '[hidden]');
  for (const secret of secrets) {
    if (secret.length >= 6) out = out.split(secret).join('[hidden]');
  }
  return out;
}

function chain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const extra = current as { code?: unknown; errors?: unknown };
    parts.push(current.name);
    if (typeof extra.code === 'string' || typeof extra.code === 'number') {
      parts.push(String(extra.code));
    }
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(' ');
}

function statusOf(error: unknown): number | undefined {
  const { code, $metadata, response } =
    (error as {
      code?: unknown;
      $metadata?: { httpStatusCode?: unknown };
      response?: { status?: unknown };
    } | null) ?? {};
  const raw = [code, $metadata?.httpStatusCode, response?.status].find(
    (value) => typeof value === 'number' || (typeof value === 'string' && /^\d{3}$/.test(value)),
  );
  return raw === undefined ? undefined : Number(raw);
}

const NETWORK =
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPIPE|fetch failed|socket hang up|CONNECT tunnel|certificate|UND_ERR_CONNECT|getaddrinfo/i;

const HOSTS: Record<StorageDriverName, string> = {
  gcs: 'storage.googleapis.com and oauth2.googleapis.com',
  s3: 'the S3 endpoint',
  local: 'the disk',
};

/** One reason and what to do about it, for a failure of `target`'s driver. Plain English, ASCII. */
export function adviceFor(
  error: unknown,
  target: CheckTarget,
): { reason: StorageFailure; advice: string } {
  const text = chain(error);
  const status = statusOf(error);
  const who = target.serviceAccountEmail
    ? `"${target.serviceAccountEmail}"`
    : 'the service account';
  const bucket = target.where ? `"${target.where}"` : 'the bucket';

  if (error instanceof StorageMismatchError) {
    return {
      reason: 'integrity',
      advice: `${error.message} The storage answered, but not with what was written. Run it again; if it repeats, tell the developer.`,
    };
  }
  if (
    /FIREBASE_SERVICE_ACCOUNT|FIREBASE_STORAGE_BUCKET|is required when STORAGE_DRIVER|Invalid environment|ServiceAccountError|EnvError/i.test(
      text,
    )
  ) {
    return {
      reason: 'config',
      advice:
        'The storage settings are incomplete or wrong (see the line above). Run: npm run setup:firebase, ' +
        'or fix the named setting in .env.local.',
    };
  }
  if (
    /invalid_grant|Invalid JWT|invalid_client|account not found|Token has been expired/i.test(text)
  ) {
    return {
      reason: 'auth',
      advice:
        "Google refused the service-account login (invalid_grant). Usual causes: this computer's clock is wrong " +
        '(more than 5 minutes off: sync it, Windows: Settings > Time & language > Sync now), or the key was ' +
        'deleted or disabled. Generate a new key (Firebase console > Project settings > Service accounts) and ' +
        'run: npm run setup:firebase',
    };
  }
  if (
    target.driver === 'gcs' &&
    /specified bucket does not exist|NoSuchBucket|bucket.*not found/i.test(text)
  ) {
    return {
      reason: 'bucket',
      advice:
        `The bucket ${bucket} does not exist. Check FIREBASE_STORAGE_BUCKET (it looks like my-project.firebasestorage.app, ` +
        'Firebase console > Storage shows it) and that you pressed "Get started" in Storage for this project.',
    };
  }
  if (target.driver === 's3' && /NoSuchBucket/i.test(text)) {
    return {
      reason: 'bucket',
      advice: `The bucket ${bucket} does not exist. Check S3_BUCKET, S3_ENDPOINT and S3_REGION.`,
    };
  }
  if (
    status === 403 ||
    /AccessDenied|Forbidden|does not have storage\.|Permission .* denied|caller does not have/i.test(
      text,
    )
  ) {
    return {
      reason: 'permission',
      advice:
        target.driver === 'gcs'
          ? `Access denied (403). ${who} needs the role "Storage Object Admin" on the bucket ${bucket}: ` +
            'Google Cloud console > IAM & Admin > IAM > Grant access (or Cloud Storage > the bucket > Permissions). ' +
            'It can take a minute to apply.'
          : 'Access denied (403). The access key is valid but may not read and write this bucket: check its policy.',
    };
  }
  if (
    status === 401 ||
    /Could not refresh access token|Invalid Credentials|unauthorized|InvalidAccessKeyId|SignatureDoesNotMatch/i.test(
      text,
    )
  ) {
    return {
      reason: 'auth',
      advice:
        target.driver === 'gcs'
          ? 'Google did not accept the credentials (401). Download a fresh key (Firebase console > Project settings > Service accounts) and run: npm run setup:firebase'
          : 'The storage did not accept the access key (401/403). Check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.',
    };
  }
  if (/took longer than|timed out|ETIMEDOUT|timeout/i.test(text)) {
    return {
      reason: 'timeout',
      advice: `The storage took too long to answer. Check the connection to ${HOSTS[target.driver]} (VPN, proxy, firewall) and run it again.`,
    };
  }
  if (NETWORK.test(text)) {
    return {
      reason: 'network',
      advice:
        `This computer could not reach ${HOSTS[target.driver]} (ENOTFOUND or similar). Check your internet connection, ` +
        'a VPN or proxy, DNS, and that a firewall or antivirus is not blocking Node.js.',
    };
  }
  if (/EACCES|EPERM|EROFS|ENOSPC|EMFILE/i.test(text)) {
    return {
      reason: 'disk',
      advice:
        'The media folder cannot be written (permissions, a full disk or a read-only disk). ' +
        'Check STORAGE_LOCAL_DIR and that the user running the site may write there.',
    };
  }
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  return { reason: 'unknown', advice: `${name}: ${message}` };
}

export interface StorageCheckDeps {
  storage: StorageDriver;
  target: CheckTarget;
  say?: (line: string) => void;
  /** Literal values that must never appear in output (access keys, key text). */
  secrets?: readonly string[];
  /** Replaceable for tests. */
  payload?: Uint8Array;
  clock?: () => number;
}

const TOTAL_STEPS = 7;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && Buffer.from(a).equals(Buffer.from(b));
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Writes a small random object under `healthcheck/`, then reads it back whole, as a range and as
 * a suffix range, deletes it and confirms it is gone. Stops at the first failure and says what to
 * do about it; the object is removed again even then.
 */
export async function runStorageCheck(deps: StorageCheckDeps): Promise<StorageCheckResult> {
  const { storage, target } = deps;
  const scrub = (line: string) => scrubSecrets(line, deps.secrets);
  const say = (line: string) => (deps.say ?? console.log)(scrub(line));
  const clock = deps.clock ?? (() => performance.now());
  const payload = deps.payload ?? new Uint8Array(randomBytes(4096));
  const key = `healthcheck/${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.bin`;
  const steps: CheckStep[] = [];
  const startedAt = clock();
  let created = false;
  let deleted = false;
  let current = 'start';

  async function step(label: string, work: () => Promise<void>) {
    current = label;
    const begin = clock();
    await work();
    const ms = Math.round(clock() - begin);
    steps.push({ step: label, ms });
    say(`${String(steps.length)}/${TOTAL_STEPS} ${label} ... ok (${String(ms)} ms)`);
  }

  const mismatch = (what: string) => new StorageMismatchError(`${what} came back different.`);
  const total = payload.byteLength;

  try {
    await step(`write ${String(total)} random bytes`, async () => {
      const written = await storage.put(key, payload, { mimeType: 'application/octet-stream' });
      created = true;
      if (written.bytes !== total) throw mismatch('The byte count of the write');
    });
    await step('read the size and type (head)', async () => {
      const info = await storage.head(key);
      if (!info) throw new StorageMismatchError('The object just written cannot be found.');
      if (info.size !== total) throw mismatch('The size');
      if (info.mimeType !== 'application/octet-stream') throw mismatch('The content type');
    });
    await step('read it back whole', async () => {
      const read = await storage.get(key);
      if (read.size !== total) throw mismatch('The size');
      if (!sameBytes(await readAll(read.stream), payload)) throw mismatch('The content');
    });
    await step('read bytes 0-9 (range)', async () => {
      const read = await storage.get(key, { start: 0, end: 9 });
      if (read.size !== total || read.range?.start !== 0 || read.range.end !== 9) {
        throw mismatch('The range answer');
      }
      if (!sameBytes(await readAll(read.stream), payload.subarray(0, 10))) {
        throw mismatch('The first ten bytes');
      }
    });
    await step('read the last 5 bytes (suffix range)', async () => {
      const read = await storage.get(key, { start: -5 });
      if (read.range?.start !== total - 5 || read.range.end !== total - 1) {
        throw mismatch('The suffix range answer');
      }
      if (!sameBytes(await readAll(read.stream), payload.subarray(total - 5))) {
        throw mismatch('The last five bytes');
      }
    });
    await step('delete it', async () => {
      await storage.delete(key);
      deleted = true;
    });
    await step('confirm it is gone', async () => {
      if ((await storage.head(key)) !== null) throw mismatch('The delete (head still finds it)');
      try {
        await storage.get(key);
      } catch (error) {
        if (isAppError(error) && error.code === 'not_found') return;
        throw error;
      }
      throw mismatch('The delete (get still returns it)');
    });
  } catch (error) {
    const { reason, advice } = adviceFor(error, target);
    say(`${String(steps.length + 1)}/${TOTAL_STEPS} ${current} ... FAILED`);
    if (created && !deleted) {
      try {
        await storage.delete(key);
        say(`Removed the test object ${key} again.`);
      } catch {
        say(`The test object ${key} could not be removed; delete it by hand if you like.`);
      }
    }
    return { ok: false, step: current, reason, advice: scrub(advice) };
  }
  return { ok: true, steps, totalMs: Math.round(clock() - startedAt) };
}

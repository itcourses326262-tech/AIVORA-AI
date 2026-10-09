// Shared by `npm run migrate:media`: copies every object of the local media folder to the remote
// storage driver, under the same keys. It only ever READS the local files (never deletes or
// changes them), skips what the remote already has with the right size, verifies each copy by its
// size, and can be stopped and run again at any point.
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import { assertMimeType } from '@/server/storage/mime';
import type { StorageDriver } from '@/server/storage/types';
import { listLocalObjects, type LocalObject } from './media-files';
import { scrubSecrets } from './storage-check';

export interface AssetRef {
  storageKey: string;
  thumbKey: string | null;
  mimeType: string;
}

export const DEFAULT_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 32;
/** Thumbnails are always written as WebP (src/server/uploads/accept.ts). */
const THUMB_MIME = 'image/webp';
const DEFAULT_MIME = 'application/octet-stream';
/** Stops early when every attempt fails the same way (wrong credentials, no network, ...). */
const GIVE_UP_AFTER = 5;

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export interface MigrateArgs {
  apply: boolean;
  concurrency: number;
  help: boolean;
}

export const MIGRATE_USAGE = [
  'usage: npm run migrate:media -- [--apply] [--concurrency <1-32>]',
  '',
  '  (no flags)          dry run: lists how many files and bytes would be copied',
  '  --apply             copy them to the configured remote storage (STORAGE_DRIVER=gcs or s3)',
  `  --concurrency <n>   files copied at the same time (default ${String(DEFAULT_CONCURRENCY)})`,
].join('\n');

/** The parsed flags, or the reason they cannot be used. */
export function parseMigrateArgs(argv: readonly string[]): MigrateArgs | { error: string } {
  const parsed: MigrateArgs = { apply: false, concurrency: DEFAULT_CONCURRENCY, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--concurrency' || arg.startsWith('--concurrency=')) {
      const raw = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[(index += 1)];
      const value = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isInteger(value) || value < 1 || value > MAX_CONCURRENCY) {
        return {
          error: `--concurrency needs a whole number from 1 to ${String(MAX_CONCURRENCY)}.`,
        };
      }
      parsed.concurrency = value;
    } else {
      return { error: `Unknown argument: ${arg}` };
    }
  }
  return parsed;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit] as string}`;
}

/** `image/PNG; charset=x` -> `image/png`; undefined when it is not a usable type. */
function cleanMime(raw: string | undefined): string | undefined {
  const value = (raw ?? '').split(';')[0]?.trim().toLowerCase();
  if (!value || value === DEFAULT_MIME) return undefined;
  try {
    assertMimeType(value);
    return value;
  } catch {
    return undefined;
  }
}

/** Where a content type comes from, in order: the assets table, the local sidecar, the extension. */
export function contentTypeResolver(
  assets: readonly AssetRef[],
): (key: string, sidecarMime: string | undefined) => string {
  const known = new Map<string, string>();
  for (const asset of assets) {
    const main = cleanMime(asset.mimeType);
    if (main) known.set(asset.storageKey, main);
    if (asset.thumbKey) known.set(asset.thumbKey, THUMB_MIME);
  }
  return (key, sidecarMime) =>
    known.get(key) ??
    cleanMime(sidecarMime) ??
    EXTENSION_MIME[path.posix.extname(key).slice(1).toLowerCase()] ??
    DEFAULT_MIME;
}

export interface Failure {
  key: string;
  message: string;
}

export interface MigrationSummary {
  apply: boolean;
  total: { objects: number; bytes: number };
  /** Copied (apply) or still to copy (dry run). */
  toCopy: { objects: number; bytes: number };
  alreadyThere: { objects: number; bytes: number };
  failed: Failure[];
  notAttempted: number;
  ignored: Array<{ path: string; reason: string }>;
  /** Asset rows whose file is not on this disk. */
  missingLocally: string[];
}

export interface MigrationDeps {
  sourceDir: string;
  /** Reads the local files; the local driver in production. */
  source: StorageDriver;
  remote: StorageDriver;
  assets: readonly AssetRef[];
  apply: boolean;
  concurrency: number;
  say: (line: string) => void;
  /** Literal values to keep out of every printed line. */
  secrets?: readonly string[];
}

async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
  stopped: () => boolean,
): Promise<number> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!stopped()) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      await work(item);
    }
  });
  await Promise.all(lanes);
  return Math.max(0, items.length - next);
}

export async function migrateMedia(deps: MigrationDeps): Promise<MigrationSummary> {
  const { source, remote, apply } = deps;
  const scrub = (line: string) => scrubSecrets(line, deps.secrets);
  const say = (line: string) => deps.say(scrub(line));

  let listing;
  try {
    listing = await listLocalObjects(deps.sourceDir);
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'ENOENT') throw error;
    listing = { objects: [] as LocalObject[], ignored: [] };
  }
  const { objects, ignored } = listing;
  const onDisk = new Set(objects.map((object) => object.key));
  const missingLocally = [
    ...new Set(
      deps.assets.flatMap((asset) => [
        asset.storageKey,
        ...(asset.thumbKey ? [asset.thumbKey] : []),
      ]),
    ),
  ].filter((key) => !onDisk.has(key));
  const contentType = contentTypeResolver(deps.assets);

  const summary: MigrationSummary = {
    apply,
    total: {
      objects: objects.length,
      bytes: objects.reduce((sum, object) => sum + object.size, 0),
    },
    toCopy: { objects: 0, bytes: 0 },
    alreadyThere: { objects: 0, bytes: 0 },
    failed: [],
    notAttempted: 0,
    ignored,
    missingLocally,
  };

  say(
    `${String(objects.length)} files on this disk (${formatBytes(summary.total.bytes)}) in ${deps.sourceDir}`,
  );
  for (const entry of ignored.slice(0, 10)) say(`Ignored ${entry.path}: ${entry.reason}`);
  if (ignored.length > 10) say(`... and ${String(ignored.length - 10)} more ignored files.`);

  let done = 0;
  let consecutiveFailures = 0;
  let lastFailure = '';
  let skippedSinceLine = 0;
  const give = () => consecutiveFailures >= GIVE_UP_AFTER;

  async function handle(object: LocalObject): Promise<void> {
    const { key, size } = object;
    try {
      const existing = await remote.head(key);
      if (existing && existing.size === size) {
        summary.alreadyThere.objects += 1;
        summary.alreadyThere.bytes += size;
        done += 1;
        skippedSinceLine += 1;
        if (skippedSinceLine >= 50) {
          say(
            `[${String(done)}/${String(objects.length)}] ... ${String(skippedSinceLine)} already there, skipped`,
          );
          skippedSinceLine = 0;
        }
        consecutiveFailures = 0;
        return;
      }
      if (!apply) {
        summary.toCopy.objects += 1;
        summary.toCopy.bytes += size;
        done += 1;
        consecutiveFailures = 0;
        return;
      }
      const local = await source.get(key);
      const body = Readable.fromWeb(local.stream as NodeWebStream);
      let written: { bytes: number };
      try {
        written = await remote.put(key, body, {
          mimeType: contentType(key, local.mimeType),
        });
      } finally {
        body.destroy();
      }
      if (written.bytes !== local.size) {
        throw new Error(
          `sent ${String(written.bytes)} bytes but the local file has ${String(local.size)} (changed while copying? run again)`,
        );
      }
      const stored = await remote.head(key);
      if (!stored || stored.size !== local.size) {
        throw new Error(
          `after the copy the remote object has ${stored ? String(stored.size) : 'no'} bytes, expected ${String(local.size)}`,
        );
      }
      summary.toCopy.objects += 1;
      summary.toCopy.bytes += local.size;
      done += 1;
      consecutiveFailures = 0;
      say(`[${String(done)}/${String(objects.length)}] copied ${key} (${formatBytes(local.size)})`);
    } catch (error) {
      const message = scrub(error instanceof Error ? error.message : String(error));
      done += 1;
      summary.failed.push({ key, message });
      consecutiveFailures = message === lastFailure ? consecutiveFailures + 1 : 1;
      lastFailure = message;
      say(`[${String(done)}/${String(objects.length)}] FAILED ${key}: ${message}`);
    }
  }

  summary.notAttempted = await runPool(objects, deps.concurrency, handle, give);
  if (summary.notAttempted > 0) {
    say(
      `Stopped after ${String(GIVE_UP_AFTER)} failures in a row with the same message; ${String(summary.notAttempted)} files were not tried.`,
    );
  }
  return summary;
}

/** The closing report, as lines. */
export function summaryLines(summary: MigrationSummary): string[] {
  const lines: string[] = [''];
  const verb = summary.apply ? 'Copied' : 'To copy';
  lines.push(summary.apply ? 'Summary' : 'Summary (DRY RUN, nothing was copied)');
  lines.push(
    `  files on disk      ${String(summary.total.objects)} (${formatBytes(summary.total.bytes)})`,
  );
  lines.push(
    `  already there      ${String(summary.alreadyThere.objects)} (${formatBytes(summary.alreadyThere.bytes)})`,
  );
  lines.push(
    `  ${verb.toLowerCase().padEnd(18)} ${String(summary.toCopy.objects)} (${formatBytes(summary.toCopy.bytes)})`,
  );
  if (summary.failed.length > 0)
    lines.push(`  FAILED             ${String(summary.failed.length)}`);
  if (summary.notAttempted > 0) lines.push(`  not tried          ${String(summary.notAttempted)}`);
  if (summary.missingLocally.length > 0) {
    lines.push(
      `  in the database but not on this disk: ${String(summary.missingLocally.length)} (fine if they were saved after the switch)`,
    );
  }
  if (summary.failed.length > 0) {
    lines.push('', 'Failures (run the command again to retry only these):');
    for (const failure of summary.failed.slice(0, 20)) {
      lines.push(`  ${failure.key}: ${failure.message}`);
    }
    if (summary.failed.length > 20)
      lines.push(`  ... and ${String(summary.failed.length - 20)} more.`);
  }
  return lines;
}

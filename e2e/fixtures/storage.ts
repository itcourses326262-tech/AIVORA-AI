import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The media directory of the server under test (`STORAGE_LOCAL_DIR`, a child of the run's scratch
 * directory that `playwright.config.ts` publishes as `AIVORE_E2E_DIR`). The server stores objects
 * as `u/<userId>/<generationId or "uploads">/<assetId>.<ext>` plus a `.thumb.webp` and a hidden
 * mime-type sidecar next to each.
 *
 * A 404 from the media route only proves that the DATABASE ROW is gone; that the file is gone from
 * the disk (the erasure a user is promised when they delete a creation or their account) can only
 * be seen here.
 */
function mediaRoot(): string {
  const dir = process.env.AIVORE_E2E_DIR;
  if (!dir) throw new Error('AIVORE_E2E_DIR is not set: run through playwright.config.ts');
  return join(dir, 'media');
}

async function filesBelow(directory: string, relative: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(join(directory, relative), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) found.push(...(await filesBelow(directory, path)));
    else found.push(path);
  }
  return found.sort();
}

/**
 * Every file the server keeps for `userId` (hidden sidecars included), as paths below the media
 * directory; limited to one generation's folder (or `uploads`) when `folder` is given. Empty
 * folders do not count: only a file is data.
 */
export async function storedFiles(userId: string, folder?: string): Promise<string[]> {
  return filesBelow(mediaRoot(), folder ? join('u', userId, folder) : join('u', userId));
}

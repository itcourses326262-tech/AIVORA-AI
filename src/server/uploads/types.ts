// OWNER: storage
import 'server-only';
import type { Kind } from '@/lib/catalog/types';
import type { AssetRow } from '@/server/db/schema';

/** A row of the `assets` table. */
export type AssetRecord = AssetRow;

export interface PersistOutputInput {
  userId: string;
  generationId: string;
  /** Position among the generation's outputs. */
  index: number;
  kind: Kind;
  /**
   * The finished file. A stream is for large videos: it is written through to storage without
   * being held in memory (images and GIFs are buffered, because they are decoded for dimensions
   * and a thumbnail).
   */
  bytes: Uint8Array | NodeJS.ReadableStream;
  /** What the provider claims; the real type is detected from the bytes whenever possible. */
  mimeType: string;
  /** For videos; images are probed with sharp instead. */
  durationMs?: number;
  /** Provider-reported size, used for videos (images are probed). */
  width?: number;
  height?: number;
  /** A preview image the provider supplied (any image format), used for videos that cannot be decoded here. */
  thumbBytes?: Uint8Array;
}

/**
 * An output already written to storage, ready to become an `assets` row. `completeGeneration`
 * inserts the rows in the same transaction that marks the generation succeeded, so storing an
 * output never creates a row on its own.
 */
export interface PersistedOutput {
  /** `ast_…`, also the file name in the storage key. */
  assetId: string;
  index: number;
  kind: Kind;
  storageKey: string;
  thumbKey?: string;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  sha256?: string;
}

// OWNER: engine — real mapping from rows to the wire contract (section 5). Extend additively only.
import 'server-only';
import type { AssetDTO, GenerationDTO } from '@/lib/api-types';
import type { AssetRow, GenerationRow } from '@/server/db/schema';

const MEDIA_PATH = '/api/v1/media';

/** Public shape of a stored file. The URLs go through the media route, which checks access. */
export function toAssetDTO(row: AssetRow): AssetDTO {
  const url = `${MEDIA_PATH}/${row.id}`;
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mimeType,
    bytes: row.bytes,
    url,
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
    ...(row.thumbKey === null ? {} : { thumbUrl: `${url}?variant=thumb` }),
  };
}

export interface GenerationDTOParts {
  /** Output assets of the generation, in any order. Input assets in this list are ignored. */
  outputs: readonly AssetRow[];
  /** The uploaded input image, if the generation has one. */
  input?: AssetRow | null;
  /** Pass the owner's display name on public feeds only. */
  owner?: { name: string };
}

/**
 * Public shape of a generation. Internal fields (provider, provider job id and metadata, worker,
 * lease, attempts, idempotency key, owner id) are never exposed.
 */
export function toGenerationDTO(row: GenerationRow, parts: GenerationDTOParts): GenerationDTO {
  const outputs = parts.outputs
    .filter((asset) => asset.role === 'output')
    .toSorted((a, b) => a.index - b.index || a.createdAt - b.createdAt)
    .map(toAssetDTO);
  return {
    id: row.id,
    tool: row.tool,
    kind: row.kind,
    modelId: row.modelId,
    prompt: row.prompt,
    ...(row.negativePrompt === null ? {} : { negativePrompt: row.negativePrompt }),
    params: row.params,
    status: row.status,
    progress: row.progress,
    cost: row.cost,
    ...(row.errorCode === null
      ? {}
      : { error: { code: row.errorCode, message: row.errorMessage ?? '' } }),
    outputs,
    ...(parts.input ? { input: toAssetDTO(parts.input) } : {}),
    isPublic: row.isPublic,
    isFavorite: row.isFavorite,
    createdAt: row.createdAt,
    ...(row.startedAt === null ? {} : { startedAt: row.startedAt }),
    ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt }),
    ...(parts.owner ? { owner: { name: parts.owner.name } } : {}),
  };
}

/**
 * The shape shown on public feeds and share pages. On top of {@link toGenerationDTO} it drops what
 * only the owner may see: the input image (input assets are never shared, so its URLs would 404)
 * and the favorite flag, which is the owner's private bookmark.
 */
export function toPublicGenerationDTO(
  row: GenerationRow,
  parts: { outputs: readonly AssetRow[]; owner: { name: string } },
): GenerationDTO {
  return { ...toGenerationDTO(row, parts), isFavorite: false };
}

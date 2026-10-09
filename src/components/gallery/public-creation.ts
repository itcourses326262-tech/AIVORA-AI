/**
 * What a public page may know about a shared creation. The public API returns a whole
 * `GenerationDTO` with the account name in `owner.name`; Explore and the share page keep only what
 * they show, and of the name only the first word (`firstNameOf`: the API already cuts it, this is the
 * second layer), so nothing else can reach the markup, the page data sent to the browser or the
 * client-side state. An address is never a name: a first word with an `@` is dropped.
 */
import type { AssetDTO, GenerationDTO, GenerationParams, Kind, Tool } from '@/lib/api-types';
import { firstNameOf } from '@/lib/public-name';

export { firstNameOf };

export interface PublicCreation {
  id: string;
  tool: Tool;
  kind: Kind;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  /** The settings that describe the result; never the seed, the strength or the cost. */
  params: Pick<GenerationParams, 'aspectRatio' | 'durationSec' | 'resolution'>;
  createdAt: number;
  /** Succeeded results, in order; never the input picture. */
  outputs: AssetDTO[];
  /** The owner's first name, or null when the account name gives no usable one. */
  ownerFirstName: string | null;
}

export function toPublicCreation(generation: GenerationDTO): PublicCreation {
  const { aspectRatio, durationSec, resolution } = generation.params;
  return {
    id: generation.id,
    tool: generation.tool,
    kind: generation.kind,
    modelId: generation.modelId,
    prompt: generation.prompt,
    ...(generation.negativePrompt ? { negativePrompt: generation.negativePrompt } : {}),
    params: {
      aspectRatio,
      ...(durationSec === undefined ? {} : { durationSec }),
      ...(resolution === undefined ? {} : { resolution }),
    },
    createdAt: generation.createdAt,
    outputs: generation.outputs.map((output) => ({ ...output })),
    ownerFirstName: firstNameOf(generation.owner?.name),
  };
}

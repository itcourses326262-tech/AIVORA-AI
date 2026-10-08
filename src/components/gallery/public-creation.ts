/**
 * What a public page may know about a shared creation. The public API returns a whole
 * `GenerationDTO` with the account name in `owner.name`; Explore and the share page keep only what
 * they show, and of the name only the first word, so nothing else can reach the page, the
 * client-side state or the markup. An address is never a name: a first word with an `@` becomes
 * "anonymous".
 */
import type { AssetDTO, GenerationDTO, Kind, Tool } from '@/lib/api-types';

export interface PublicCreation {
  id: string;
  tool: Tool;
  kind: Kind;
  modelId: string;
  prompt: string;
  createdAt: number;
  /** Succeeded results, in order; never the input picture. */
  outputs: AssetDTO[];
  /** The owner's first name, or null when the account name gives no usable one. */
  ownerFirstName: string | null;
}

const MAX_FIRST_NAME_CHARS = 24;
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

/**
 * The first word of an account name, ready to show. Null for nothing usable: an empty name, or a
 * word that looks like an email address or a link, which people sometimes type as their name.
 */
export function firstNameOf(name: string | null | undefined): string | null {
  const word = (name ?? '').normalize('NFC').replace(INVISIBLE, '').trim().split(/\s+/u)[0] ?? '';
  if (word === '' || /[@/\\]/.test(word)) return null;
  return Array.from(word).slice(0, MAX_FIRST_NAME_CHARS).join('');
}

export function toPublicCreation(generation: GenerationDTO): PublicCreation {
  return {
    id: generation.id,
    tool: generation.tool,
    kind: generation.kind,
    modelId: generation.modelId,
    prompt: generation.prompt,
    createdAt: generation.createdAt,
    outputs: generation.outputs,
    ownerFirstName: firstNameOf(generation.owner?.name),
  };
}

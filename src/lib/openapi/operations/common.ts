import { GENERATION_STATUSES } from '@/lib/api-types';
import { KINDS } from '@/lib/catalog/types';
import { MAX_BATCH_IDS } from '@/server/generations/list';
import { MAX_IDEMPOTENCY_KEY_CHARS } from '@/server/generations/idempotency';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/server/http/request';
import type { ParamSpec } from '../operation';
import { IDS } from '../examples';

/** Crockford base32 body of every id: 26 lower-case characters. */
const ID_BODY = '[0-9a-hjkmnp-tv-z]{26}';

export function idPathParam(
  name: string,
  prefix: 'gen' | 'key' | 'ast',
  description: string,
  example: string,
): ParamSpec {
  return {
    name,
    in: 'path',
    description,
    schema: { type: 'string', pattern: `^${prefix}_${ID_BODY}$` },
    example,
  };
}

export const generationIdParam = idPathParam(
  'id',
  'gen',
  'The generation id. Another account’s id is a 404.',
  IDS.generation,
);

export function limitParam(defaultLimit: number): ParamSpec {
  return {
    name: 'limit',
    in: 'query',
    description: `How many items per page, 1 to ${MAX_PAGE_LIMIT}.`,
    schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_LIMIT, default: defaultLimit },
    example: defaultLimit,
  };
}

export const defaultLimitParam = limitParam(DEFAULT_PAGE_LIMIT);

export const cursorParam: ParamSpec = {
  name: 'cursor',
  in: 'query',
  description: 'The `nextCursor` of the previous page. Opaque: do not build or parse it.',
  schema: { type: 'string', minLength: 1, maxLength: 512 },
};

export const idempotencyKeyParam: ParamSpec = {
  name: 'Idempotency-Key',
  in: 'header',
  description: `Makes a retry safe: 1 to ${MAX_IDEMPOTENCY_KEY_CHARS} visible ASCII characters, unique per request you intend to make once (a UUID works). The same key with the same request returns the original generation; with a different request it is a 409.`,
  schema: { type: 'string', minLength: 1, maxLength: MAX_IDEMPOTENCY_KEY_CHARS },
  example: '0b7f3c52-8f3e-4a52-9a5e-3c1d6f5c9e10',
};

export const kindParam: ParamSpec = {
  name: 'kind',
  in: 'query',
  description: 'Only images or only videos.',
  schema: { type: 'string', enum: [...KINDS] },
};

export const statusParam: ParamSpec = {
  name: 'status',
  in: 'query',
  description: 'Only generations in this status.',
  schema: { type: 'string', enum: [...GENERATION_STATUSES] },
};

export const batchIdsDescription = `Comma-separated generation ids (or repeat the parameter), 1 to ${MAX_BATCH_IDS}. Returns exactly those generations, without paging: the cheap way to poll many at once. Other accounts’ and unknown ids are left out.`;

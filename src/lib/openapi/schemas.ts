/**
 * Zod descriptions of the response bodies, the part of the API contract that exists only as
 * TypeScript interfaces (`@/lib/api-types`). Each schema is wrapped in `exact<Dto>()`, which fails
 * the TYPE CHECK when the schema and the interface differ in any field, so a DTO cannot change
 * without its documentation changing with it. Request bodies are NOT described here: the real
 * schemas of the routes are imported by `spec.ts`.
 */
import { z } from 'zod';
import {
  GENERATION_STATUSES,
  LEDGER_REASONS,
  USER_ROLES,
  type ApiKeyDTO,
  type AssetDTO,
  type CreateApiKeyResponse,
  type EnhancePromptResponse,
  type GenerationDTO,
  type LedgerEntryDTO,
  type ModelDTO,
  type UserDTO,
  type ValidationDetails,
} from '@/lib/api-types';
import {
  ASPECT_RATIOS,
  KINDS,
  MODEL_BADGES,
  PROVIDER_IDS,
  RESOLUTIONS,
  TOOLS,
  type GenerationParams,
} from '@/lib/catalog/types';
import { ERROR_CODES } from '@/lib/errors';
import { LOCALES } from '@/lib/i18n/locales';
import type { ToolSpec } from '@/lib/tools';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * `exact<UserDTO>()(schema)` returns `schema` untouched, and is a compile error unless the
 * schema's output type is exactly `UserDTO` (the second argument becomes required, and `never`,
 * when the types differ).
 */
function exact<T>() {
  return <S extends z.ZodType>(
    schema: S,
    ..._proof: Equal<z.output<S>, T> extends true ? [] : [never]
  ): S => schema;
}

const timestamp = (what: string) =>
  z.number().int().describe(`${what}, in milliseconds since the Unix epoch.`);

// ---- Errors -----------------------------------------------------------------------------------

export const validationDetailsSchema = exact<ValidationDetails>()(
  z.object({
    issues: z
      .array(
        z.object({
          path: z
            .string()
            .describe(
              'Dotted path of the field in the request, such as `params.count`. Empty for the whole body.',
            ),
          message: z.string().describe('What is wrong, in English.'),
        }),
      )
      .describe('Every problem found, so one request is enough to fix them all.'),
  }),
);

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES).describe('Stable machine-readable code. Branch on this.'),
    message: z.string().describe('English text for developers and logs. Do not show it to users.'),
    details: z
      .unknown()
      .optional()
      .describe(
        'Extra data for some codes: `issues` for `validation_failed`, `retryAfterSec` for `rate_limited` and `service_busy`, `required` and `balance` for `insufficient_credits`.',
      ),
  }),
});

// ---- Resources --------------------------------------------------------------------------------

export const userSchema = exact<UserDTO>()(
  z.object({
    id: z.string().describe('User id, `usr_` followed by 26 characters.'),
    email: z.string().describe('Sign-in address, lower case.'),
    name: z.string().describe('Display name.'),
    role: z.enum(USER_ROLES),
    locale: z.enum(LOCALES).describe('Preferred language of the web app.'),
    creditBalance: z.number().int().describe('Credits the account can spend right now.'),
    createdAt: timestamp('When the account was created'),
  }),
);

export const assetSchema = exact<AssetDTO>()(
  z.object({
    id: z.string().describe('Asset id, `ast_` followed by 26 characters.'),
    kind: z.enum(KINDS),
    mimeType: z
      .string()
      .describe(
        'Content type of the file. Demo videos are animated GIFs (`image/gif`); real providers return `video/mp4`.',
      ),
    width: z.number().int().optional().describe('Pixels.'),
    height: z.number().int().optional().describe('Pixels.'),
    durationMs: z.number().int().optional().describe('Length of a video, in milliseconds.'),
    bytes: z.number().int().describe('Size of the file.'),
    url: z
      .string()
      .describe('Path of the file, `/api/v1/media/{id}`. Send the same credentials to fetch it.'),
    thumbUrl: z
      .string()
      .optional()
      .describe('Path of the 512 px WebP thumbnail, when there is one (`?variant=thumb`).'),
  }),
);

const generationParamsSchema = exact<GenerationParams>()(
  z.object({
    aspectRatio: z.enum(ASPECT_RATIOS).describe('Width to height of the result.'),
    count: z.number().int().describe('How many images were requested. Videos are always 1.'),
    durationSec: z.number().int().optional().describe('Video length in seconds.'),
    resolution: z.enum(RESOLUTIONS).optional().describe('Video resolution; it sets the price.'),
    seed: z.number().int().optional().describe('The seed, when one was given.'),
    strength: z.number().optional().describe('How far image-to-image strays from the input.'),
  }),
);

export const generationSchema = exact<GenerationDTO>()(
  z.object({
    id: z.string().describe('Generation id, `gen_` followed by 26 characters.'),
    tool: z.enum(TOOLS).describe('The tool that was run.'),
    kind: z.enum(KINDS).describe('`image` or `video`, following the tool.'),
    modelId: z.string().describe('The model that was used.'),
    prompt: z.string().describe('The prompt, trimmed.'),
    negativePrompt: z.string().optional().describe('What the request asked to avoid.'),
    params: generationParamsSchema.describe(
      'The parameters actually used, with defaults filled in.',
    ),
    status: z.enum(GENERATION_STATUSES),
    progress: z.number().int().describe('0 to 100. Only moves forward.'),
    cost: z.number().int().describe('Credits charged. Refunded in full if the generation fails.'),
    error: z
      .object({
        code: z
          .string()
          .describe(
            'Why it failed: `invalid_input`, `content_policy`, `rate_limited`, `unavailable`, `timeout`, `internal` or `interrupted`.',
          ),
        message: z.string().describe('English, user-safe.'),
      })
      .optional()
      .describe('Present when `status` is `failed`.'),
    outputs: z
      .array(assetSchema)
      .describe('The results, in order. Empty until the generation succeeds.'),
    input: assetSchema
      .optional()
      .describe('The input image of an image-to-image or image-to-video generation.'),
    isPublic: z.boolean().describe('Whether the results appear on the public Explore feed.'),
    isFavorite: z.boolean(),
    createdAt: timestamp('When the request was accepted'),
    startedAt: timestamp('When a worker picked it up').optional(),
    finishedAt: timestamp('When it reached a final status').optional(),
    owner: z
      .object({ name: z.string() })
      .optional()
      .describe('Only on the public Explore feed. The name is the first word of the account name.'),
  }),
);

const modelLimitsSchema = z.object({
  maxPromptChars: z.number().int().describe('Longest prompt this model accepts, in characters.'),
  aspectRatios: z.array(z.enum(ASPECT_RATIOS)),
  defaultAspectRatio: z.enum(ASPECT_RATIOS),
  maxCount: z.number().int().describe('Most outputs per generation.'),
  defaultCount: z.number().int(),
  durations: z.array(z.number().int()).optional().describe('Allowed video lengths in seconds.'),
  defaultDuration: z.number().int().optional(),
  resolutions: z.array(z.enum(RESOLUTIONS)).optional(),
  defaultResolution: z.enum(RESOLUTIONS).optional(),
  supportsNegativePrompt: z.boolean(),
  supportsSeed: z.boolean(),
  supportsStrength: z.boolean(),
  followsInputAspect: z
    .boolean()
    .optional()
    .describe(
      'The result keeps the proportions of the input image. `aspectRatio` is accepted and ignored.',
    ),
});

const modelPricingSchema = z.union([
  z.object({ type: z.literal('image'), perImage: z.number().int().describe('Credits per image.') }),
  z.object({
    type: z.literal('video'),
    perSecond: z
      .object({
        '480p': z.number().int().optional(),
        '720p': z.number().int().optional(),
        '1080p': z.number().int().optional(),
      })
      .describe('Credits per second of video, by resolution.'),
  }),
]);

export const modelSchema = exact<ModelDTO>()(
  z.object({
    id: z.string().describe('Pass this as `modelId` when you create a generation.'),
    provider: z.enum(PROVIDER_IDS),
    kind: z.enum(KINDS),
    tools: z.array(z.enum(TOOLS)).describe('The tools this model serves.'),
    label: z.string(),
    description: z.object({ en: z.string(), ar: z.string() }),
    badges: z.array(z.enum(MODEL_BADGES)).optional(),
    limits: modelLimitsSchema,
    pricing: modelPricingSchema,
    available: z
      .boolean()
      .describe(
        'False when the provider is not configured on this deployment. Such models cannot be used.',
      ),
    unavailableReason: z.literal('not_configured').optional(),
  }),
);

export const toolSchema = exact<ToolSpec>()(
  z.object({
    id: z.enum(TOOLS),
    kind: z.enum(KINDS),
    needsInputImage: z
      .boolean()
      .describe('When true, the request must carry `inputAssetId` (see `POST /uploads`).'),
    icon: z.string().describe('lucide icon name, for UIs.'),
    i18nKey: z.string().describe('Message key prefix used by the web app.'),
  }),
);

export const ledgerEntrySchema = exact<LedgerEntryDTO>()(
  z.object({
    id: z.string().describe('Ledger entry id, `led_` followed by 26 characters.'),
    delta: z.number().int().describe('Credits added (positive) or spent (negative).'),
    balanceAfter: z.number().int().describe('The balance right after this entry.'),
    reason: z.enum(LEDGER_REASONS),
    generationId: z
      .string()
      .optional()
      .describe('The generation this entry is about. Absent for grants and purchases.'),
    note: z.string().optional(),
    createdAt: timestamp('When it was recorded'),
  }),
);

export const apiKeySchema = exact<ApiKeyDTO>()(
  z.object({
    id: z.string().describe('Key id, `key_` followed by 26 characters. Use it to revoke the key.'),
    name: z.string(),
    prefix: z
      .string()
      .describe('The first characters of the key, such as `avk_ab12cd34`. Enough to recognise it.'),
    createdAt: timestamp('When the key was created'),
    lastUsedAt: timestamp(
      'The last request made with it (updated at most every 5 minutes)',
    ).optional(),
    revokedAt: timestamp('When it was revoked').optional(),
  }),
);

export const createApiKeyResponseSchema = exact<CreateApiKeyResponse>()(
  z.object({
    key: z
      .string()
      .describe(
        'The full secret, `avk_<prefix>_<secret>`. This response is the only time it is ever shown: store it now.',
      ),
    record: apiKeySchema,
  }),
);

export const enhancePromptResponseSchema = exact<EnhancePromptResponse>()(
  z.object({
    prompt: z.string().describe('The improved prompt.'),
    engine: z.enum(['openai', 'anthropic', 'heuristic']).describe('What produced it.'),
    translated: z.boolean().describe('True when an Arabic draft came back in English.'),
  }),
);

// ---- Small payloads of the account flows ------------------------------------------------------

export const acceptedSchema = z.object({
  accepted: z.literal(true).describe('The request was taken. Nothing else is revealed.'),
});

export const verifyEmailRequestSchema = z.object({
  sent: z.boolean().describe('A new confirmation link was sent.'),
  verified: z.boolean().describe('The address was already confirmed, so nothing was sent.'),
  resendAfterSec: z
    .number()
    .int()
    .describe('Seconds to wait before asking for another link; 0 when nothing was sent.'),
});

export const verifyEmailConfirmSchema = z.object({
  verified: z.literal(true),
  alreadyVerified: z.boolean(),
  bonusCredits: z.number().int().describe('Signup credits released by the confirmation.'),
});

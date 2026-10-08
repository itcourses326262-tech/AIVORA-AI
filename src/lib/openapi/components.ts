/**
 * `components` of the document: every named schema, the reusable headers and the security schemes.
 * Request schemas are the REAL ones the routes validate with (imported, never re-typed); the
 * descriptions the routes do not carry are added with `annotate`, which copies instead of mutating.
 */
import { GENERATION_STATUSES } from '@/lib/api-types';
import { ERROR_CODES, ERROR_STATUS } from '@/lib/errors';
import { createGenerationRequestSchema } from '@/lib/validation/generation';
import { enhancePromptRequestSchema } from '@/lib/validation/prompt';
import { z } from 'zod';
import { API_KEY_NAME_MAX } from '@/server/auth/api-keys';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/server/auth/password';
import {
  changePasswordSchema,
  confirmEmailSchema,
  createApiKeySchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateAccountSchema,
} from '@/server/auth/schemas';
import { NAME_MAX_LENGTH } from '@/server/auth/validation';
import { ERROR_CODE_DOCS } from './errors';
import { JSON_SCHEMA_DIALECT, SchemaCatalog, annotate, componentRef } from './json-schema';
import {
  acceptedSchema,
  apiKeySchema,
  assetSchema,
  createApiKeyResponseSchema,
  enhancePromptResponseSchema,
  generationSchema,
  ledgerEntrySchema,
  modelSchema,
  toolSchema,
  userSchema,
  validationDetailsSchema,
  verifyEmailConfirmSchema,
  verifyEmailRequestSchema,
} from './schemas';
import type { HeaderObject, JsonSchema, OpenApiComponents, SecuritySchemeObject } from './types';

export { JSON_SCHEMA_DIALECT };

/** Every key of `components.schemas`. Operations refer to schemas by these names only. */
export const SCHEMA_IDS = [
  'ErrorCode',
  'ErrorBody',
  'ValidationDetails',
  'User',
  'Asset',
  'Generation',
  'Model',
  'Tool',
  'LedgerEntry',
  'ApiKey',
  'CreatedApiKey',
  'EnhancedPrompt',
  'Accepted',
  'VerifyEmailRequestResult',
  'VerifyEmailConfirmResult',
  'CreateGenerationRequest',
  'UpdateGenerationRequest',
  'EnhancePromptRequest',
  'UploadRequest',
  'RegisterRequest',
  'LoginRequest',
  'UpdateAccountRequest',
  'ChangePasswordRequest',
  'CreateApiKeyRequest',
  'DeleteAccountRequest',
  'ForgotPasswordRequest',
  'ResetPasswordRequest',
  'ConfirmEmailRequest',
] as const;
export type SchemaId = (typeof SCHEMA_IDS)[number];

export function ref(id: SchemaId): JsonSchema {
  return componentRef(id);
}

/** `PATCH /generations/{id}`: the route keeps this schema to itself, so its shape is repeated here. */
const updateGenerationSchema = z
  .object({ isPublic: z.boolean().optional(), isFavorite: z.boolean().optional() })
  .strict();

const errorCodeSchema: JsonSchema = {
  type: 'string',
  enum: [...ERROR_CODES],
  description:
    'Stable machine-readable code of an error. Branch on this, never on the English `message`.',
  'x-enum-descriptions': Object.fromEntries(
    ERROR_CODES.map((code) => [code, ERROR_CODE_DOCS[code].meaning]),
  ),
  'x-enum-statuses': Object.fromEntries(ERROR_CODES.map((code) => [code, ERROR_STATUS[code]])),
};

const errorBodySchema: JsonSchema = {
  type: 'object',
  description: 'Every failed request answers with this body, whatever the status.',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: ref('ErrorCode'),
        message: {
          type: 'string',
          description: 'English text for developers and logs. Do not show it to users.',
        },
        details: {
          description:
            'Extra data for some codes: `issues` for `validation_failed` (see ValidationDetails), `retryAfterSec` for `rate_limited` and `service_busy`, `required` and `balance` for `insufficient_credits`, `reason` for some `conflict` and `bad_request` errors.',
        },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
};

const uploadRequestSchema: JsonSchema = {
  type: 'object',
  properties: {
    file: {
      type: 'string',
      format: 'binary',
      description:
        'The image: PNG, JPEG or WebP, at most `MAX_UPLOAD_MB` (10 MB by default). Send exactly one `file` field. Metadata is stripped and the image is scaled down to 4096 px.',
    },
  },
  required: ['file'],
};

function registerResponses(catalog: SchemaCatalog): void {
  catalog.add(userSchema, { id: 'User', description: 'An account.' });
  catalog.add(assetSchema, { id: 'Asset', description: 'A stored image or video.' });
  catalog.add(generationSchema, {
    id: 'Generation',
    description: 'One generation request and, once it has finished, its results.',
  });
  catalog.add(modelSchema, {
    id: 'Model',
    description: 'A model of the catalog with its limits, price and availability.',
  });
  catalog.add(toolSchema, { id: 'Tool', description: 'One of the four generation tools.' });
  catalog.add(ledgerEntrySchema, {
    id: 'LedgerEntry',
    description: 'One change of the credit balance.',
  });
  catalog.add(apiKeySchema, {
    id: 'ApiKey',
    description: 'An API key as listed: never the secret, only enough to recognise it.',
  });
  catalog.add(createApiKeyResponseSchema, {
    id: 'CreatedApiKey',
    description: 'A new API key. `key` is shown once.',
  });
  catalog.add(enhancePromptResponseSchema, {
    id: 'EnhancedPrompt',
    description: 'The improved prompt.',
  });
  catalog.add(acceptedSchema, { id: 'Accepted' });
  catalog.add(verifyEmailRequestSchema, { id: 'VerifyEmailRequestResult' });
  catalog.add(verifyEmailConfirmSchema, { id: 'VerifyEmailConfirmResult' });
  catalog.add(validationDetailsSchema, {
    id: 'ValidationDetails',
    description: 'The `details` of a `validation_failed` error.',
  });
}

function registerRequests(catalog: SchemaCatalog): void {
  catalog.add(createGenerationRequestSchema, { id: 'CreateGenerationRequest' });
  catalog.add(updateGenerationSchema, { id: 'UpdateGenerationRequest' });
  catalog.add(enhancePromptRequestSchema, { id: 'EnhancePromptRequest' });
  catalog.add(registerSchema, { id: 'RegisterRequest' });
  catalog.add(loginSchema, { id: 'LoginRequest' });
  catalog.add(updateAccountSchema, { id: 'UpdateAccountRequest' });
  catalog.add(changePasswordSchema, { id: 'ChangePasswordRequest' });
  catalog.add(createApiKeySchema, { id: 'CreateApiKeyRequest' });
  catalog.add(deleteAccountSchema, { id: 'DeleteAccountRequest' });
  catalog.add(forgotPasswordSchema, { id: 'ForgotPasswordRequest' });
  catalog.add(resetPasswordSchema, { id: 'ResetPasswordRequest' });
  catalog.add(confirmEmailSchema, { id: 'ConfirmEmailRequest' });
}

/** Sentences the route schemas do not carry. Limits are the services' real ones, not the coarse gates. */
function describeRequests(schemas: Record<string, JsonSchema>): void {
  const pick = (id: SchemaId): JsonSchema => {
    const schema = schemas[id];
    if (!schema) throw new Error(`Missing schema ${id}`);
    return schema;
  };
  const set = (id: SchemaId, notes: Parameters<typeof annotate>[1]) => {
    schemas[id] = annotate(pick(id), notes);
  };

  set('CreateGenerationRequest', {
    '': 'Starts a generation. Unknown fields are rejected, so a typo cannot silently fall back to a default.',
    tool: 'The tool to run. The model must serve it (see `tools` of each model).',
    modelId: 'A model whose `available` is true, from `GET /models`.',
    prompt:
      "What to create. At most the model's `limits.maxPromptChars` characters (never more than 4000).",
    negativePrompt:
      'What to avoid. Only models with `supportsNegativePrompt` take one; for the others it is a 422.',
    params:
      'Optional settings. What you leave out takes the model default; a value the model does not allow is a 422, never silently changed.',
    'params.aspectRatio':
      "One of the model's `aspectRatios`. Ignored by models that follow the input image.",
    'params.count': "How many images. At most the model's `maxCount`; videos are always 1.",
    'params.durationSec': "Video length in seconds, one of the model's `durations`.",
    'params.resolution': "One of the model's `resolutions`. It sets the price.",
    'params.seed': 'Repeats a result. Only models with `supportsSeed`.',
    'params.strength':
      'How far image-to-image may stray from the input, 0 to 1. Only models with `supportsStrength`, and only with an input image.',
    inputAssetId:
      'Required by image-to-image and image-to-video, forbidden for the text tools: the id of an image you uploaded (`POST /uploads`) or that one of your own generations produced. Videos and other people’s assets are a 404.',
    isPublic: 'List the results on the public Explore feed. Default false.',
  });

  set('UpdateGenerationRequest', {
    '': {
      description: 'Send `isPublic` and/or `isFavorite`. Nothing else can be changed.',
      minProperties: 1,
    },
    isPublic: 'Show the results on the public Explore feed and the share page.',
    isFavorite: 'Mark as a favourite in the web gallery.',
  });

  set('EnhancePromptRequest', {
    '': 'A draft to improve. It is moderated like any prompt first.',
    prompt: 'The draft, 1 to 2000 characters.',
    kind: 'What the prompt is for. It decides which vocabulary is added.',
    locale: 'Language to assume when the script of the draft does not make it clear.',
  });

  set('RegisterRequest', {
    email: 'ASCII address, at most 254 characters. Stored in lower case.',
    password: `${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters. Very common passwords and the address itself are refused.`,
    name: {
      description: `Display name, 1 to ${NAME_MAX_LENGTH} printable characters.`,
      minLength: 1,
      maxLength: NAME_MAX_LENGTH,
    },
    locale: 'Language of the web app for this account. Falls back to Accept-Language, then `ar`.',
  });
  set('LoginRequest', {
    email: 'The address the account was registered with.',
    password: 'The account password.',
  });
  set('UpdateAccountRequest', {
    '': { description: 'Send `name` and/or `locale`.', minProperties: 1 },
    name: {
      description: `Display name, 1 to ${NAME_MAX_LENGTH} printable characters.`,
      minLength: 1,
      maxLength: NAME_MAX_LENGTH,
    },
    locale: 'Preferred language of the web app. Also sets the `aivore_locale` cookie.',
  });
  set('ChangePasswordRequest', {
    currentPassword: 'The password in use now. A wrong one is a 422 at `currentPassword`.',
    newPassword: {
      description: `${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters, different from the current one.`,
      maxLength: PASSWORD_MAX_LENGTH,
    },
  });
  set('CreateApiKeyRequest', {
    name: {
      description: `A label to recognise the key by, 1 to ${API_KEY_NAME_MAX} printable characters.`,
      minLength: 1,
      maxLength: API_KEY_NAME_MAX,
    },
  });
  set('DeleteAccountRequest', { password: 'The current password, to confirm.' });
  set('ForgotPasswordRequest', { email: 'The address of the account to recover.' });
  set('ResetPasswordRequest', {
    token: 'The secret from the emailed link (`?token=`).',
    password: `The new password, ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`,
  });
  set('ConfirmEmailRequest', { token: 'The secret from the emailed link (`?token=`).' });
}

function describeResponses(schemas: Record<string, JsonSchema>): void {
  const generation = schemas.Generation;
  if (generation?.properties?.status) {
    generation.properties.status = {
      ...generation.properties.status,
      description:
        '`queued` and `processing` are in progress; `succeeded`, `failed` and `canceled` are final.',
      'x-statuses': [...GENERATION_STATUSES],
    };
  }
}

/** `components.schemas`, complete and ready to serialise. */
export function buildSchemas(): Record<string, JsonSchema> {
  const requests = new SchemaCatalog('input');
  registerRequests(requests);
  const responses = new SchemaCatalog('output');
  registerResponses(responses);

  const schemas: Record<string, JsonSchema> = {
    ErrorCode: errorCodeSchema,
    ErrorBody: errorBodySchema,
    UploadRequest: uploadRequestSchema,
    ...responses.schemas(),
    ...requests.schemas(),
  };
  describeRequests(schemas);
  describeResponses(schemas);

  const missing = SCHEMA_IDS.filter((id) => !(id in schemas));
  if (missing.length > 0) throw new Error(`Schemas declared but not built: ${missing.join(', ')}`);
  return Object.fromEntries(SCHEMA_IDS.map((id) => [id, schemas[id] as JsonSchema]));
}

// ---- Headers ----------------------------------------------------------------------------------

export const HEADER_NAMES = [
  'X-Request-Id',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Retry-After',
  'Location',
  'Idempotent-Replayed',
  'Set-Cookie',
] as const;
export type HeaderName = (typeof HEADER_NAMES)[number];

const HEADERS: Record<HeaderName, HeaderObject> = {
  'X-Request-Id': {
    description:
      'Identifies the request in our logs. A sane `X-Request-Id` you send is echoed back; quote it when you report a problem.',
    schema: { type: 'string' },
  },
  'X-RateLimit-Limit': {
    description: 'Requests allowed in the window of the budget this request was counted against.',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Remaining': {
    description: 'Requests left in the current window.',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Reset': {
    description: 'When the window ends, in seconds since the Unix epoch.',
    schema: { type: 'integer' },
  },
  'Retry-After': {
    description: 'Seconds to wait before trying again.',
    schema: { type: 'integer' },
  },
  Location: {
    description: 'Path of the created or replayed resource.',
    schema: { type: 'string' },
  },
  'Idempotent-Replayed': {
    description:
      'Always `true`: this answer replays an earlier request with the same `Idempotency-Key`.',
    schema: { type: 'string', enum: ['true'] },
  },
  'Set-Cookie': {
    description:
      'Sets the HttpOnly `aivore_session` cookie and the `aivore_locale` preference cookie (or clears the session cookie when the session ends).',
    schema: { type: 'string' },
  },
};

export function headerRef(name: HeaderName): { $ref: string } {
  return { $ref: `#/components/headers/${name}` };
}

// ---- Security ---------------------------------------------------------------------------------

export const SECURITY_SCHEMES: Record<'bearerAuth' | 'cookieAuth', SecuritySchemeObject> = {
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'avk_<prefix>_<secret>',
    description:
      'An API key from the Account page: `Authorization: Bearer avk_...`. Keys work for generating, uploading, reading and the account endpoints marked so; creating keys and changing the password need a browser session.',
  },
  cookieAuth: {
    type: 'apiKey',
    in: 'cookie',
    name: 'aivore_session',
    description:
      'The browser session cookie set by `POST /auth/login`. Requests that change data must also send an `Origin` header equal to the site origin (CSRF protection).',
  },
};

export function buildComponents(): OpenApiComponents {
  return {
    schemas: buildSchemas(),
    headers: HEADERS,
    securitySchemes: SECURITY_SCHEMES,
  };
}

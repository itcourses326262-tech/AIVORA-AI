import {
  GENERATION_CREATE_LIMIT,
  GENERATION_READ_LIMIT,
  GENERATION_WRITE_LIMIT,
} from '@/app/api/v1/generations/limits';
import { ref } from '../components';
import {
  generationCanceledExample,
  generationProcessingExample,
  generationQueuedExample,
  generationSucceededExample,
  IDS,
} from '../examples';
import {
  data,
  empty,
  failure,
  pageOf,
  rateLimit,
  rateLimited,
  unauthorized,
  validationFailed,
  type EndpointSpec,
} from '../operation';
import {
  batchIdsDescription,
  cursorParam,
  defaultLimitParam,
  generationIdParam,
  idempotencyKeyParam,
  kindParam,
  statusParam,
} from './common';

export const GENERATIONS_TAG = 'Generations';

const createBody = {
  tool: 'text-to-image',
  modelId: 'aivore-demo-image',
  prompt: 'A lighthouse at dawn, soft fog, cinematic',
  params: { aspectRatio: '16:9' },
};

const readLimit = (access: 'any') => rateLimit(GENERATION_READ_LIMIT, access);
const writeLimit = (access: 'any') => rateLimit(GENERATION_WRITE_LIMIT, access);

export const generationEndpoints: EndpointSpec[] = [
  {
    operationId: 'createGeneration',
    tag: GENERATIONS_TAG,
    method: 'post',
    path: '/generations',
    summary: 'Create a generation',
    description: [
      'Starts a generation and returns it at once with status `queued`. The cost is charged when the request is accepted and refunded in full if the generation fails or is canceled; a result with fewer outputs than `params.count` refunds the missing share.',
      'The work runs in the background. Poll `GET /generations/{id}` until `status` is `succeeded`, `failed` or `canceled`, then download each `outputs[].url`. There are no webhooks.',
      'Send an `Idempotency-Key` header to make retries safe: repeating the same request with the same key returns the original generation (200, `Idempotent-Replayed: true`) and charges nothing more. The same key with a different request is a 409.',
      'By default an account can have 4 generations in progress at once (`too_many_active`); the limit is `details.limit`.',
    ].join('\n\n'),
    access: 'any',
    limits: [rateLimit(GENERATION_CREATE_LIMIT, 'any')],
    params: [idempotencyKeyParam],
    curl: { headers: { 'Idempotency-Key': String(idempotencyKeyParam.example) } },
    request: {
      description: 'What to create. The body is at most 64 KiB.',
      schema: ref('CreateGenerationRequest'),
      example: createBody,
    },
    responses: [
      data(
        201,
        'Accepted and queued. `Location` is the path of the new generation.',
        ref('Generation'),
        generationQueuedExample,
        ['Location'],
      ),
      data(
        200,
        'A replay of an earlier request with the same `Idempotency-Key`: the original generation, nothing charged.',
        ref('Generation'),
        generationQueuedExample,
        ['Location', 'Idempotent-Replayed'],
      ),
      unauthorized(),
      failure('insufficient_credits', 'The balance does not cover the cost. Nothing was charged.', {
        details: { required: 3, balance: 1 },
      }),
      failure(
        'email_not_verified',
        'Where email confirmation is required, the account has not confirmed its address yet. A cookie-authenticated request without a matching `Origin` is also a 403 (`forbidden`).',
      ),
      failure('not_found', 'The `inputAssetId` does not exist, is not yours, or is not an image.', {
        details: { path: 'inputAssetId' },
      }),
      failure(
        'conflict',
        'The model is not configured on this deployment (`details.reason` is `model_unavailable`), or the `Idempotency-Key` was used for a different request (`idempotency_key_reused`).',
        { details: { reason: 'model_unavailable', modelId: 'fal-flux-schnell' } },
      ),
      failure('payload_too_large', 'The body is larger than 64 KiB.'),
      validationFailed(
        'The request is not valid (`validation_failed`, every problem listed in `details.issues`), or the prompt goes against the content policy (`moderation_blocked`, `details.category`). Nothing is charged.',
        [{ path: 'params.count', message: 'count must be at most 4 for this model' }],
      ),
      failure(
        'too_many_active',
        'The rate limit is spent (`rate_limited`), or too many of your generations are running (`too_many_active`, `details.limit`).',
        { status: 429, details: { limit: 4 } },
      ),
      failure(
        'service_busy',
        'The platform is not accepting new paid generations for a while. `details.retryAfterSec` and `Retry-After` say when to retry.',
        { details: { retryAfterSec: 600 }, headers: ['Retry-After'] },
      ),
    ],
  },
  {
    operationId: 'listGenerations',
    tag: GENERATIONS_TAG,
    method: 'get',
    path: '/generations',
    summary: 'List your generations',
    description:
      'Your generations, newest first, in pages. Filter by kind, status or favourites, search the prompts with `q`, or fetch up to 50 specific generations with `ids`.',
    access: 'any',
    limits: [readLimit('any')],
    curl: { query: { status: 'succeeded', limit: 20 } },
    params: [
      kindParam,
      statusParam,
      {
        name: 'favorite',
        in: 'query',
        description: 'Only favourites (`true`, `1`) or only the others (`false`, `0`).',
        schema: { type: 'string', enum: ['true', 'false', '1', '0'] },
      },
      {
        name: 'q',
        in: 'query',
        description:
          'Text to look for in the prompts, 1 to 200 characters. Searches have an extra budget of 60 per minute.',
        schema: { type: 'string', minLength: 1, maxLength: 200 },
        example: 'lighthouse',
      },
      {
        name: 'ids',
        in: 'query',
        description: batchIdsDescription,
        schema: { type: 'string' },
        example: `${IDS.generation},${IDS.generationVideo}`,
      },
      defaultLimitParam,
      cursorParam,
    ],
    responses: [
      pageOf('A page of generations.', ref('Generation'), [
        generationSucceededExample,
        generationProcessingExample,
      ]),
      unauthorized(),
      validationFailed('A parameter is not valid, for example more than 50 `ids`.', [
        { path: 'ids', message: 'At most 50 ids per request' },
      ]),
      rateLimited(),
    ],
  },
  {
    operationId: 'getGeneration',
    tag: GENERATIONS_TAG,
    method: 'get',
    path: '/generations/{id}',
    summary: 'Get a generation',
    description:
      'One generation with its current `status`, `progress` and, once it has succeeded, the `outputs`. Poll this while `status` is `queued` or `processing`: every 2 seconds for images and every 5 for videos is plenty.',
    access: 'any',
    limits: [readLimit('any')],
    params: [generationIdParam],
    responses: [
      data(200, 'The generation.', ref('Generation'), generationSucceededExample),
      unauthorized(),
      failure('not_found', 'No generation of yours has this id.'),
      rateLimited(),
    ],
  },
  {
    operationId: 'updateGeneration',
    tag: GENERATIONS_TAG,
    method: 'patch',
    path: '/generations/{id}',
    summary: 'Share or favourite a generation',
    description:
      'Changes `isPublic` (show the results on the public Explore feed and a share page) and/or `isFavorite`. Nothing else can be changed.',
    access: 'any',
    limits: [writeLimit('any')],
    params: [generationIdParam],
    request: {
      description: 'The flags to change.',
      schema: ref('UpdateGenerationRequest'),
      example: { isPublic: true },
    },
    responses: [
      data(200, 'The updated generation.', ref('Generation'), {
        ...generationSucceededExample,
        isPublic: true,
      }),
      unauthorized(),
      failure('not_found', 'No generation of yours has this id.'),
      validationFailed('Neither flag was sent, or an unknown field was.', [
        { path: '', message: 'Send isPublic and/or isFavorite' },
      ]),
      rateLimited(),
    ],
  },
  {
    operationId: 'deleteGeneration',
    tag: GENERATIONS_TAG,
    method: 'delete',
    path: '/generations/{id}',
    summary: 'Delete a generation',
    description:
      'Deletes a generation and its stored files. One that is still running is canceled and refunded first. Uploaded input images are kept. The credit history keeps its rows, without the link to the deleted generation.',
    access: 'any',
    limits: [writeLimit('any')],
    params: [generationIdParam],
    responses: [
      empty(204, 'Deleted.'),
      unauthorized(),
      failure('not_found', 'No generation of yours has this id.'),
      rateLimited(),
    ],
  },
  {
    operationId: 'cancelGeneration',
    tag: GENERATIONS_TAG,
    method: 'post',
    path: '/generations/{id}/cancel',
    summary: 'Cancel a generation',
    description:
      'Stops a `queued` or `processing` generation and refunds its cost in full. Canceling a generation that is already canceled is harmless and returns it again.',
    access: 'any',
    limits: [writeLimit('any')],
    params: [generationIdParam],
    responses: [
      data(200, 'The canceled generation.', ref('Generation'), generationCanceledExample),
      unauthorized(),
      failure('not_found', 'No generation of yours has this id.'),
      failure('conflict', 'It has already succeeded or failed; there is nothing to cancel.'),
      rateLimited(),
    ],
  },
];

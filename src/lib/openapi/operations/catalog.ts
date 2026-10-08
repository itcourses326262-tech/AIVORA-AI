import { EXPLORE_LIMIT } from '@/app/api/v1/generations/limits';
import { CATALOG_RATE_LIMIT } from '@/app/api/v1/models/rate-limit';
import { ref } from '../components';
import {
  enhancedPromptExample,
  generationSucceededExample,
  imageModelExample,
  toolsExample,
  videoModelExample,
} from '../examples';
import {
  data,
  pageOf,
  rateLimit,
  rateLimited,
  unauthorized,
  validationFailed,
  type EndpointSpec,
} from '../operation';
import { cursorParam, limitParam, kindParam } from './common';

export const CATALOG_TAG = 'Models and tools';
export const EXPLORE_TAG = 'Explore';
export const PROMPT_TAG = 'Prompt';

export const catalogEndpoints: EndpointSpec[] = [
  {
    operationId: 'listModels',
    tag: CATALOG_TAG,
    method: 'get',
    path: '/models',
    summary: 'List the models',
    description: [
      'Every model of the catalog with its limits, its price in credits and whether it can be used on this deployment. Models whose provider is not configured are listed with `available: false` and cannot be used.',
      'The limits tell you what a request may contain: prompt length, aspect ratios, image count, video durations and resolutions, and whether a negative prompt, a seed or a strength are supported. Available models come first, then images before videos. Credentials are optional; the answer is the same for everybody.',
    ].join('\n\n'),
    access: 'optional',
    limits: [rateLimit(CATALOG_RATE_LIMIT, 'optional')],
    responses: [
      data(200, 'The catalog.', { type: 'array', items: ref('Model') }, [
        imageModelExample,
        videoModelExample,
      ]),
      rateLimited(),
    ],
  },
  {
    operationId: 'listTools',
    tag: CATALOG_TAG,
    method: 'get',
    path: '/tools',
    summary: 'List the tools',
    description:
      'The four generation tools: text to image, image to image, text to video and image to video. `needsInputImage` tells you which ones require an `inputAssetId`.',
    access: 'optional',
    limits: [rateLimit(CATALOG_RATE_LIMIT, 'optional')],
    responses: [
      data(200, 'The tools.', { type: 'array', items: ref('Tool') }, toolsExample),
      rateLimited(),
    ],
  },
  {
    operationId: 'listExplore',
    tag: EXPLORE_TAG,
    method: 'get',
    path: '/explore',
    summary: 'Browse the public feed',
    description:
      'Succeeded generations their owners chose to share, newest first, with the owner’s display name. No account is needed and credentials are not read. The answer may be cached for a few seconds.',
    access: 'public',
    limits: [rateLimit(EXPLORE_LIMIT, 'public')],
    params: [kindParam, limitParam(24), cursorParam],
    responses: [
      pageOf('A page of shared generations.', ref('Generation'), [
        { ...generationSucceededExample, isPublic: true, owner: { name: 'Layla' } },
      ]),
      validationFailed('A parameter is not valid.', [
        { path: 'limit', message: 'Number must be less than or equal to 100' },
      ]),
      rateLimited(),
    ],
  },
  {
    operationId: 'enhancePrompt',
    tag: PROMPT_TAG,
    method: 'post',
    path: '/prompt/enhance',
    summary: 'Improve a prompt',
    description:
      'Rewrites a short draft into a richer prompt (subject, style, lighting, composition). Uses a language model when the deployment has a key for one and a built-in heuristic otherwise; `engine` says which. Arabic drafts may come back in English because most models understand English best (`translated`). The draft is moderated first, so this cannot be used to get around the content policy. It costs no credits.',
    access: 'any',
    limits: [rateLimit({ name: 'prompt-enhance', limit: 20, windowSec: 60, by: 'user' }, 'any')],
    request: {
      description: 'The draft. The body is at most 16 KiB.',
      schema: ref('EnhancePromptRequest'),
      example: { prompt: 'a lighthouse at dawn', kind: 'image' },
    },
    responses: [
      data(200, 'The improved prompt.', ref('EnhancedPrompt'), enhancedPromptExample),
      unauthorized(),
      validationFailed(
        'The draft is empty or too long (`validation_failed`), or it goes against the content policy (`moderation_blocked`).',
        [{ path: 'prompt', message: 'String must contain at most 2000 character(s)' }],
      ),
      rateLimited(),
    ],
  },
];

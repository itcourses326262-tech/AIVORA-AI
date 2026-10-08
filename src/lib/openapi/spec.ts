import 'server-only';
import { APP_VERSION } from '@/lib/version';
import { buildComponents, JSON_SCHEMA_DIALECT } from './components';
import { buildOperation, type EndpointSpec } from './operation';
import { accountEndpoints, ACCOUNT_TAG, keyEndpoints, KEYS_TAG } from './operations/account';
import { authEndpoints, AUTH_TAG } from './operations/auth';
import { catalogEndpoints, CATALOG_TAG, EXPLORE_TAG, PROMPT_TAG } from './operations/catalog';
import { generationEndpoints, GENERATIONS_TAG } from './operations/generations';
import { mediaEndpoints, MEDIA_TAG } from './operations/media';
import { referenceEndpoints, REFERENCE_TAG } from './operations/reference';
import type { OpenApiDocument, PathItemObject, SecurityRequirement, TagObject } from './types';

/** In the order the documentation presents them. */
export const API_TAGS: readonly TagObject[] = [
  {
    name: GENERATIONS_TAG,
    description:
      'Create images and videos from text or from an image, then follow each one until it is done.',
  },
  {
    name: CATALOG_TAG,
    description: 'Which models and tools exist, what they accept and what they cost.',
  },
  {
    name: MEDIA_TAG,
    description: 'Upload input images and download results.',
  },
  { name: PROMPT_TAG, description: 'Improve a prompt before you spend credits on it.' },
  { name: EXPLORE_TAG, description: 'The public feed of results their owners chose to share.' },
  {
    name: ACCOUNT_TAG,
    description: 'Your profile, credits, password and data.',
  },
  {
    name: KEYS_TAG,
    description:
      'Create and revoke the API keys that authenticate your code. Key management itself needs a browser session.',
  },
  {
    name: AUTH_TAG,
    description:
      'The sign-in flows of the web app. A server using an API key never needs them; they are listed for completeness and for custom clients.',
  },
  { name: REFERENCE_TAG, description: 'This API as a machine-readable document.' },
];

const ENDPOINTS: readonly EndpointSpec[] = [
  ...generationEndpoints,
  ...catalogEndpoints,
  ...mediaEndpoints,
  ...accountEndpoints,
  ...keyEndpoints,
  ...authEndpoints,
  ...referenceEndpoints,
];

/** The endpoints as written, for tests and for generators of examples. */
export function listEndpointSpecs(): readonly EndpointSpec[] {
  return ENDPOINTS;
}

function describe(origin: string): string {
  return [
    'AIVORE turns text and images into images and videos. This is the REST API behind the web app: whatever the studio does, your code can do.',
    `**Base URL** \`${origin}/api/v1\``,
    '**Authentication** Create an API key on the Account page and send it as `Authorization: Bearer avk_...`. A browser session cookie works too for the endpoints that accept it. Key management, password changes and similar account actions are browser-only.',
    '**Format** JSON in, JSON out. A success is `{ "data": ... }`; a list is `{ "data": [...], "nextCursor": "..." | null }`; a failure is `{ "error": { "code", "message", "details" } }` with the HTTP status of the code. Branch on `error.code`, never on the English `message`.',
    '**Credits** Every generation costs credits, charged when it is accepted and refunded in full if it fails or is canceled.',
    '**Polling, not webhooks** Generations run in the background: create one, then poll `GET /generations/{id}` until its `status` is final.',
    '**Rate limits** Each endpoint has its own budget per account (per address for anonymous calls). Over it you get a 429 with `Retry-After`; successful answers carry `X-RateLimit-*` headers.',
  ].join('\n\n');
}

function pathsOf(
  endpoints: readonly EndpointSpec[],
  origin: string,
): Record<string, PathItemObject> {
  const paths: Record<string, PathItemObject> = {};
  const operationIds = new Set<string>();
  for (const [order, endpoint] of endpoints.entries()) {
    if (operationIds.has(endpoint.operationId)) {
      throw new Error(`Duplicate operationId ${endpoint.operationId}`);
    }
    operationIds.add(endpoint.operationId);
    const item = (paths[endpoint.path] ??= {});
    if (item[endpoint.method]) {
      throw new Error(`${endpoint.method.toUpperCase()} ${endpoint.path} is described twice`);
    }
    item[endpoint.method] = buildOperation(endpoint, origin, order);
  }
  return paths;
}

const cache = new Map<string, OpenApiDocument>();

/**
 * The OpenAPI 3.1 document of the developer API for a deployment at `origin` (no trailing slash).
 * Built once per origin and shared: treat the result as read-only.
 */
export function buildOpenApiDocument(origin: string): OpenApiDocument {
  const cached = cache.get(origin);
  if (cached) return cached;

  const security: SecurityRequirement[] = [{ bearerAuth: [] }, { cookieAuth: [] }];
  const document: OpenApiDocument = {
    openapi: '3.1.0',
    jsonSchemaDialect: JSON_SCHEMA_DIALECT,
    info: {
      title: 'AIVORE API',
      version: APP_VERSION,
      summary: 'Generate images and videos with AI.',
      description: describe(origin),
    },
    servers: [{ url: `${origin}/api/v1`, description: 'This deployment' }],
    tags: [...API_TAGS],
    paths: pathsOf(ENDPOINTS, origin),
    components: buildComponents(),
    security,
  };
  cache.set(origin, document);
  return document;
}

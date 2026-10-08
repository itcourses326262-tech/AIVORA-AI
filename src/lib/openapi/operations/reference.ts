import { OPENAPI_RATE_LIMIT } from '../rate-limit';
import { rateLimit, rateLimited, type EndpointSpec } from '../operation';

export const REFERENCE_TAG = 'OpenAPI';

export const referenceEndpoints: EndpointSpec[] = [
  {
    operationId: 'getOpenApiDocument',
    tag: REFERENCE_TAG,
    method: 'get',
    path: '/openapi.json',
    summary: 'This API as OpenAPI 3.1',
    description:
      'The machine-readable description of every endpoint on this page, as an OpenAPI 3.1 document. Feed it to a client generator, Postman or an API explorer. No credentials are needed; the answer is cached for a few minutes and supports `ETag` revalidation.',
    access: 'public',
    limits: [rateLimit(OPENAPI_RATE_LIMIT, 'public')],
    responses: [
      {
        status: 200,
        description: 'The OpenAPI document.',
        body: { kind: 'raw', contentTypes: ['application/json'], schema: { type: 'object' } },
      },
      { status: 304, description: 'Not modified: the `If-None-Match` ETag still matches.' },
      rateLimited(),
    ],
  },
];

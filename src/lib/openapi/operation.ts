/**
 * A small vocabulary for writing endpoints once and getting a complete OpenAPI operation:
 * security from the `access` level, the `{ data }` / page envelopes, error bodies with the right
 * status and example, and the headers every answer carries.
 */
import { ERROR_STATUS, type ErrorCode } from '@/lib/errors';
import { curlFor } from './curl';
import { ERROR_CODE_DOCS } from './errors';
import { componentRef } from './json-schema';
import { headerRef, type HeaderName } from './components';
import type {
  HttpMethod,
  JsonSchema,
  OperationObject,
  ParameterObject,
  RateLimitDoc,
  ResponseObject,
  SecurityRequirement,
} from './types';

/**
 * Who may call:
 * - `public`: no credentials are read.
 * - `optional`: works anonymously; credentials, when sent, are used.
 * - `any`: an API key or a browser session.
 * - `session`: a browser session only; an API key is refused with 403.
 */
export type Access = 'public' | 'optional' | 'any' | 'session';

export interface ParamSpec {
  name: string;
  in: ParameterObject['in'];
  description: string;
  required?: boolean;
  schema: JsonSchema;
  example?: unknown;
}

export type ResponseBody =
  | { kind: 'data'; schema: JsonSchema; example: unknown }
  | { kind: 'page'; item: JsonSchema; example: unknown[]; nextCursor?: string | null }
  | { kind: 'raw'; contentTypes: string[]; schema: JsonSchema }
  | { kind: 'error'; code: ErrorCode; details?: unknown };

export interface ResponseSpec {
  status: number;
  description: string;
  body?: ResponseBody;
  headers?: HeaderName[];
}

export interface RequestSpec {
  description: string;
  contentType?: string;
  schema: JsonSchema;
  example: unknown;
}

/** How the cURL example of an endpoint differs from the plain call. */
export interface CurlOptions {
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
  /** Overrides whether credentials are shown (they are for `any` and `session` endpoints). */
  auth?: boolean;
  /** Show the `Origin` header the same-origin check wants (default: with a cookie on a change). */
  origin?: boolean;
  /** `save`: keep the session cookie the answer sets; `send`: send the saved one. */
  cookies?: 'save' | 'send';
  /** Raw cURL flags for saving the answer, such as `-OJ`. */
  output?: string;
}

export interface EndpointSpec {
  operationId: string;
  tag: string;
  method: HttpMethod;
  /** OpenAPI path template relative to the server URL, e.g. `/generations/{id}`. */
  path: string;
  summary: string;
  description: string;
  access: Access;
  limits?: RateLimitDoc[];
  params?: ParamSpec[];
  request?: RequestSpec;
  curl?: CurlOptions;
  responses: ResponseSpec[];
}

// ---- Response constructors --------------------------------------------------------------------

export function data(
  status: number,
  description: string,
  schema: JsonSchema,
  example: unknown,
  headers: HeaderName[] = [],
): ResponseSpec {
  return { status, description, body: { kind: 'data', schema, example }, headers };
}

export function pageOf(
  description: string,
  item: JsonSchema,
  example: unknown[],
  nextCursor: string | null = null,
): ResponseSpec {
  return { status: 200, description, body: { kind: 'page', item, example, nextCursor } };
}

export function empty(status: number, description: string): ResponseSpec {
  return { status, description };
}

/** An error answer: the status follows the code unless `status` overrides it (413, 415, 416...). */
export function failure(
  code: ErrorCode,
  description: string,
  options: { status?: number; details?: unknown; headers?: HeaderName[] } = {},
): ResponseSpec {
  return {
    status: options.status ?? ERROR_STATUS[code],
    description,
    body: { kind: 'error', code, details: options.details },
    headers: options.headers,
  };
}

export const unauthorized = (): ResponseSpec =>
  failure('unauthorized', 'No valid API key or session.');

export const rateLimited = (): ResponseSpec =>
  failure('rate_limited', 'The budget of this endpoint is spent. Wait and retry.', {
    details: { retryAfterSec: 12 },
    headers: ['Retry-After'],
  });

export function validationFailed(
  description: string,
  issues: Array<{ path: string; message: string }>,
): ResponseSpec {
  return failure('validation_failed', description, { details: { issues } });
}

/** A budget in the shape `RateLimitOptions` has (the constants the routes use). */
export interface RateLimitSource {
  name: string;
  limit: number;
  windowSec: number;
  by?: 'ip' | 'user';
}

export function rateLimit(source: RateLimitSource, access: Access): RateLimitDoc {
  let scope: RateLimitDoc['scope'];
  if (source.by === 'ip') scope = 'address';
  else if (source.by === 'user' || access === 'any' || access === 'session') scope = 'user';
  else scope = access === 'public' ? 'address' : 'user-or-address';
  return { limit: source.limit, windowSec: source.windowSec, scope, bucket: source.name };
}

// ---- Operation --------------------------------------------------------------------------------

const SECURITY: Record<Access, SecurityRequirement[]> = {
  public: [],
  optional: [{}, { bearerAuth: [] }, { cookieAuth: [] }],
  any: [{ bearerAuth: [] }, { cookieAuth: [] }],
  session: [{ cookieAuth: [] }],
};

function errorBody(code: ErrorCode, details: unknown): unknown {
  return {
    error: {
      code,
      message: ERROR_CODE_DOCS[code].sample,
      ...(details === undefined ? {} : { details }),
    },
  };
}

function headerNames(spec: ResponseSpec, limited: boolean): HeaderName[] {
  const names: HeaderName[] = [];
  if (spec.status >= 200 && spec.status < 300) {
    names.push('X-Request-Id');
    if (limited) names.push('X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset');
  }
  for (const name of spec.headers ?? []) if (!names.includes(name)) names.push(name);
  return names;
}

function toContent(body: ResponseBody): ResponseObject['content'] {
  switch (body.kind) {
    case 'data':
      return {
        'application/json': {
          schema: {
            type: 'object',
            properties: { data: body.schema },
            required: ['data'],
            'x-envelope': 'data',
          },
          example: { data: body.example },
        },
      };
    case 'page':
      return {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              data: { type: 'array', items: body.item },
              nextCursor: {
                type: ['string', 'null'],
                description: 'Pass as `cursor` to get the next page. `null` on the last page.',
              },
            },
            required: ['data', 'nextCursor'],
            'x-envelope': 'page',
          },
          example: { data: body.example, nextCursor: body.nextCursor ?? null },
        },
      };
    case 'raw':
      return Object.fromEntries(body.contentTypes.map((type) => [type, { schema: body.schema }]));
    case 'error':
      return {
        'application/json': {
          schema: componentRef('ErrorBody'),
          example: errorBody(body.code, body.details),
        },
      };
  }
}

function toResponse(spec: ResponseSpec, limited: boolean): ResponseObject {
  const response: ResponseObject = { description: spec.description };
  const names = headerNames(spec, limited);
  if (names.length > 0) {
    response.headers = Object.fromEntries(names.map((name) => [name, headerRef(name)]));
  }
  if (spec.body) response.content = toContent(spec.body);
  return response;
}

export function buildOperation(spec: EndpointSpec, origin: string, order: number): OperationObject {
  const limited = (spec.limits?.length ?? 0) > 0;
  const responses: OperationObject['responses'] = {};
  for (const response of [...spec.responses].sort((a, b) => a.status - b.status)) {
    const key = String(response.status);
    if (key in responses) throw new Error(`${spec.operationId}: status ${key} is described twice`);
    responses[key] = toResponse(response, limited);
  }

  const operation: OperationObject = {
    operationId: spec.operationId,
    tags: [spec.tag],
    summary: spec.summary,
    description: spec.description,
    security: SECURITY[spec.access],
    responses,
    'x-order': order,
  };
  if (spec.params && spec.params.length > 0) {
    operation.parameters = spec.params.map((param) => ({
      name: param.name,
      in: param.in,
      description: param.description,
      required: param.in === 'path' ? true : (param.required ?? false),
      schema: param.schema,
      ...(param.example === undefined ? {} : { example: param.example }),
    }));
  }
  if (spec.request) {
    operation.requestBody = {
      description: spec.request.description,
      required: true,
      content: {
        [spec.request.contentType ?? 'application/json']: {
          schema: spec.request.schema,
          example: spec.request.example,
        },
      },
    };
  }
  operation['x-codeSamples'] = [{ lang: 'Shell', label: 'cURL', source: curlFor(spec, origin) }];
  if (limited) operation['x-rate-limit'] = spec.limits;
  if (spec.access === 'session') operation['x-session-only'] = true;
  return operation;
}

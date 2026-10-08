/**
 * Questions the reference asks of the OpenAPI document, answered once and in plain data: what an
 * operation returns, who may call it, what its budget is, where its anchor is. Components only lay
 * the answers out.
 */
import { componentIdOf } from '@/lib/openapi/json-schema';
import {
  HTTP_METHODS,
  isReference,
  type HttpMethod,
  type JsonSchema,
  type OpenApiDocument,
  type OperationObject,
  type ParameterObject,
  type RateLimitDoc,
  type ResponseObject,
} from '@/lib/openapi/types';

export type AccessKind = 'public' | 'optional' | 'any' | 'session';

/** Who may call the operation, read from its `security` alternatives. */
export function accessKind(operation: OperationObject): AccessKind {
  if (operation.security.length === 0) return 'public';
  if (operation.security.some((alternative) => Object.keys(alternative).length === 0)) {
    return 'optional';
  }
  return operation['x-session-only'] ? 'session' : 'any';
}

const REASONS: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export function statusPhrase(status: number): string {
  return REASONS[status] ?? '';
}

export const operationAnchor = (operationId: string): string => `op-${operationId}`;
export const tagAnchor = (tag: string): string =>
  `ref-${tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
export const schemaAnchor = (id: string): string => `schema-${id}`;

/** `{id}` segments of a path, so they can be set apart from the literal text. */
export function pathSegments(path: string): Array<{ text: string; parameter: boolean }> {
  return path
    .split(/(\{\w+\})/)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, parameter: part.startsWith('{') }));
}

const UNITS: ReadonlyArray<readonly [number, string]> = [
  [86_400, 'day'],
  [3_600, 'hour'],
  [60, 'minute'],
];

/** "30 requests per minute, per account": the budget as a reader would say it. */
export function budgetText(limit: RateLimitDoc): string {
  const unit = UNITS.find(([seconds]) => limit.windowSec === seconds)?.[1];
  const window = unit ? `per ${unit}` : `per ${limit.windowSec} seconds`;
  const scope = {
    user: 'per account',
    address: 'per IP address',
    'user-or-address': 'per account, or per IP address when signed out',
  }[limit.scope];
  return `${limit.limit} requests ${window}, ${scope}`;
}

export type Returns =
  | { kind: 'none' }
  | { kind: 'file'; types: string[] }
  | { kind: 'object'; ref: string; nullable: boolean }
  | { kind: 'array'; ref: string }
  | { kind: 'page'; ref: string }
  | { kind: 'inline' };

/** What a successful response carries, in the words of the reference. */
export function returnsOf(response: ResponseObject): Returns {
  const content = response.content;
  if (!content) return { kind: 'none' };
  const json = content['application/json'];
  if (!json?.schema) {
    return { kind: 'file', types: Object.keys(content) };
  }
  const schema = json.schema;
  if (schema['x-envelope'] === 'page') {
    const ref = refOf(schema.properties?.data?.items);
    return ref ? { kind: 'page', ref } : { kind: 'inline' };
  }
  if (schema['x-envelope'] === 'data') {
    const data = schema.properties?.data;
    if (!data) return { kind: 'inline' };
    const direct = refOf(data);
    if (direct) return { kind: 'object', ref: direct, nullable: false };
    if (data.type === 'array') {
      const item = refOf(data.items);
      if (item) return { kind: 'array', ref: item };
    }
    const alternatives = data.anyOf?.filter((part) => part.type !== 'null') ?? [];
    const single = alternatives.length === 1 ? refOf(alternatives[0]) : undefined;
    if (single && alternatives.length !== data.anyOf?.length) {
      return { kind: 'object', ref: single, nullable: true };
    }
  }
  return { kind: 'inline' };
}

function refOf(schema: JsonSchema | undefined): string | undefined {
  return schema?.$ref === undefined ? undefined : componentIdOf(schema.$ref);
}

export const isSuccess = (status: number): boolean => status >= 200 && status < 400;

export interface ErrorRow {
  status: number;
  code: string;
  description: string;
}

/** The error answers of an operation, with the code from the example body. */
export function errorRows(operation: OperationObject): ErrorRow[] {
  return Object.entries(operation.responses)
    .filter(([status]) => Number(status) >= 400)
    .map(([status, response]) => {
      if (isReference(response)) return { status: Number(status), code: '', description: '' };
      const example = response.content?.['application/json']?.example as
        { error?: { code?: unknown } } | undefined;
      const code = typeof example?.error?.code === 'string' ? example.error.code : '';
      return { status: Number(status), code, description: response.description };
    })
    .sort((a, b) => a.status - b.status);
}

export interface SuccessRow {
  status: number;
  response: ResponseObject;
}

export function successRows(operation: OperationObject): SuccessRow[] {
  return Object.entries(operation.responses)
    .filter(([status]) => isSuccess(Number(status)))
    .flatMap(([status, response]) =>
      isReference(response) ? [] : [{ status: Number(status), response }],
    )
    .sort((a, b) => a.status - b.status);
}

export type ParameterGroup = { location: ParameterObject['in']; parameters: ParameterObject[] };

/** Path, query and header parameters, in that order, skipping the empty groups. */
export function groupParameters(operation: OperationObject): ParameterGroup[] {
  const parameters = (operation.parameters ?? []).filter(
    (parameter): parameter is ParameterObject => !isReference(parameter),
  );
  return (['path', 'query', 'header'] as const)
    .map((location) => ({
      location,
      parameters: parameters.filter((parameter) => parameter.in === location),
    }))
    .filter((group) => group.parameters.length > 0);
}

export interface ReferenceOperation {
  id: string;
  path: string;
  method: HttpMethod;
  operation: OperationObject;
}

export interface ReferenceGroup {
  tag: string;
  description: string;
  operations: ReferenceOperation[];
}

/** The operations grouped under their tag, in the order of the document. */
export function referenceGroups(document: OpenApiDocument): ReferenceGroup[] {
  const all: ReferenceOperation[] = Object.entries(document.paths).flatMap(([path, item]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = item[method];
      return operation ? [{ id: operation.operationId, path, method, operation }] : [];
    }),
  );
  return document.tags
    .map((tag) => ({
      tag: tag.name,
      description: tag.description,
      operations: all
        .filter((entry) => entry.operation.tags.includes(tag.name))
        .toSorted((a, b) => a.operation['x-order'] - b.operation['x-order']),
    }))
    .filter((group) => group.operations.length > 0);
}

/** The component schemas a reader sees as objects: everything that is not a request body. */
export function objectSchemaIds(document: OpenApiDocument): string[] {
  return Object.keys(document.components.schemas).filter((id) => !id.endsWith('Request'));
}

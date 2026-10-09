/**
 * The slice of OpenAPI 3.1 this project produces and renders. It is not a general-purpose model of
 * the standard: only the objects and keywords `spec.ts` emits (and `flatten.ts` reads) are typed.
 * The document is plain JSON, so it can be served as is and handed to any OpenAPI tool.
 */

export type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'patch' | 'head';

/** The order operations are listed in under one path. */
export const HTTP_METHODS: readonly HttpMethod[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
];

/** JSON Schema 2020-12, as far as zod's converter and the hand-written parts use it. */
export interface JsonSchema {
  $schema?: string;
  $id?: string;
  $ref?: string;
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  examples?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  minProperties?: number;
  readOnly?: boolean;
  /** Vendor extensions (`x-...`) carry documentation the standard has no place for. */
  [extension: `x-${string}`]: unknown;
}

export type ParameterLocation = 'path' | 'query' | 'header';

export interface ParameterObject {
  name: string;
  in: ParameterLocation;
  description?: string;
  required?: boolean;
  schema: JsonSchema;
  example?: unknown;
}

export interface ReferenceObject {
  $ref: string;
}

export interface MediaTypeObject {
  schema?: JsonSchema;
  example?: unknown;
}

export interface HeaderObject {
  description?: string;
  schema: JsonSchema;
  example?: unknown;
}

export interface ResponseObject {
  description: string;
  headers?: Record<string, HeaderObject | ReferenceObject>;
  content?: Record<string, MediaTypeObject>;
}

export interface RequestBodyObject {
  description?: string;
  required?: boolean;
  content: Record<string, MediaTypeObject>;
  /** JSON bodies: the largest body the endpoint reads, in bytes; a larger one is a 413. */
  'x-max-bytes'?: number;
}

/** `{}` among the alternatives means "no credentials needed either"; an empty list means public. */
export type SecurityRequirement = Record<string, string[]>;

/** Documentation of a limit enforced by the route (`x-rate-limit`). */
export interface RateLimitDoc {
  /** Requests allowed per window. */
  limit: number;
  windowSec: number;
  /** Who the budget belongs to. */
  scope: 'user' | 'address' | 'user-or-address';
  /** Name of the bucket; routes with the same name share one budget. */
  bucket: string;
}

/** One ready-to-run example request (the `x-codeSamples` convention of Redoc and others). */
export interface CodeSample {
  lang: string;
  label: string;
  source: string;
}

export interface OperationObject {
  operationId: string;
  tags: string[];
  summary: string;
  description?: string;
  parameters?: Array<ParameterObject | ReferenceObject>;
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject | ReferenceObject>;
  security: SecurityRequirement[];
  /** Budgets this operation spends, strictest first. */
  'x-rate-limit'?: RateLimitDoc[];
  /** `true`: the operation takes a browser session only; an API key is refused with 403. */
  'x-session-only'?: boolean;
  'x-codeSamples'?: CodeSample[];
  /** Position of the operation in the reference, so related calls stay together in a sensible order. */
  'x-order': number;
}

export type PathItemObject = Partial<Record<HttpMethod, OperationObject>>;

export interface TagObject {
  name: string;
  description: string;
}

export interface SecuritySchemeObject {
  type: 'http' | 'apiKey';
  scheme?: 'bearer';
  bearerFormat?: string;
  in?: 'cookie';
  name?: string;
  description: string;
}

export interface ServerObject {
  url: string;
  description: string;
}

export interface OpenApiComponents {
  schemas: Record<string, JsonSchema>;
  headers: Record<string, HeaderObject>;
  securitySchemes: Record<string, SecuritySchemeObject>;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  jsonSchemaDialect: string;
  info: {
    title: string;
    version: string;
    summary: string;
    description: string;
    contact?: { name: string; url: string };
  };
  servers: ServerObject[];
  tags: TagObject[];
  paths: Record<string, PathItemObject>;
  components: OpenApiComponents;
  security: SecurityRequirement[];
}

export function isReference(value: unknown): value is ReferenceObject {
  return typeof value === 'object' && value !== null && '$ref' in value;
}

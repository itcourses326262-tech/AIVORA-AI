import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_STATUS } from '@/lib/errors';
import { SCHEMA_IDS } from '@/lib/openapi/components';
import { buildOpenApiDocument, listEndpointSpecs } from '@/lib/openapi/spec';
import {
  HTTP_METHODS,
  isReference,
  type JsonSchema,
  type OperationObject,
} from '@/lib/openapi/types';
import { problemsOf } from './validator';

const ORIGIN = 'https://aivore.example';
const doc = buildOpenApiDocument(ORIGIN);

function operations(): Array<{ method: string; path: string; operation: OperationObject }> {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = item[method];
      return operation ? [{ method, path, operation }] : [];
    }),
  );
}

/** Every `$ref` string anywhere in the document. */
function references(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) for (const child of node) references(child, found);
  else if (typeof node === 'object' && node !== null) {
    for (const [key, child] of Object.entries(node)) {
      if (key === '$ref' && typeof child === 'string') found.push(child);
      else references(child, found);
    }
  }
  return found;
}

function resolves(ref: string): boolean {
  const match = /^#\/components\/(schemas|headers)\/(.+)$/.exec(ref);
  if (!match) return false;
  const [, kind, id] = match;
  return (
    (kind === 'schemas' ? doc.components.schemas : doc.components.headers)[id ?? ''] !== undefined
  );
}

describe('the OpenAPI document', () => {
  it('is an OpenAPI 3.1 document for this deployment', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.jsonSchemaDialect).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(doc.info.title).toBe('AIVORE API');
    expect(doc.info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(doc.info.description).toContain(`${ORIGIN}/api/v1`);
    expect(doc.servers).toEqual([{ url: `${ORIGIN}/api/v1`, description: 'This deployment' }]);
  });

  it('is plain JSON that survives a round trip', () => {
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it('is built once per origin and differs between origins', () => {
    expect(buildOpenApiDocument(ORIGIN)).toBe(doc);
    expect(buildOpenApiDocument('https://other.example').servers[0]?.url).toBe(
      'https://other.example/api/v1',
    );
  });

  it('declares both ways to authenticate', () => {
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(doc.components.securitySchemes.cookieAuth).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'aivore_session',
    });
    expect(doc.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
  });

  it('has no dangling reference', () => {
    const refs = references(doc);
    expect(refs.length).toBeGreaterThan(50);
    expect(refs.filter((ref) => !resolves(ref))).toEqual([]);
  });

  it('declares every schema it promises, and nothing else', () => {
    expect(Object.keys(doc.components.schemas)).toEqual([...SCHEMA_IDS]);
  });
});

describe('every operation', () => {
  const all = operations();

  it('exists for each endpoint written, with a unique camelCase operationId', () => {
    expect(all).toHaveLength(listEndpointSpecs().length);
    const ids = all.map(({ operation }) => operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][A-Za-z0-9]+$/);
  });

  it('belongs to a declared tag and explains itself', () => {
    const tags = new Set(doc.tags.map((tag) => tag.name));
    for (const { method, path, operation } of all) {
      const where = `${method.toUpperCase()} ${path}`;
      expect(operation.tags, where).toHaveLength(1);
      expect(tags.has(operation.tags[0] ?? ''), `${where}: undeclared tag`).toBe(true);
      expect(operation.summary.length, `${where}: summary`).toBeGreaterThan(5);
      expect(operation.description?.length ?? 0, `${where}: description`).toBeGreaterThan(30);
    }
    for (const tag of doc.tags) {
      expect(
        all.some(({ operation }) => operation.tags.includes(tag.name)),
        `empty tag ${tag.name}`,
      ).toBe(true);
    }
  });

  it('declares exactly the path parameters its template names', () => {
    for (const { method, path, operation } of all) {
      const named = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).toSorted();
      const declared = (operation.parameters ?? [])
        .filter((parameter) => !isReference(parameter) && parameter.in === 'path')
        .map((parameter) => (isReference(parameter) ? '' : parameter.name))
        .toSorted();
      expect(declared, `${method.toUpperCase()} ${path}`).toEqual(named);
    }
  });

  it('has a successful response and describes every response', () => {
    for (const { method, path, operation } of all) {
      const where = `${method.toUpperCase()} ${path}`;
      const statuses = Object.keys(operation.responses);
      expect(
        statuses.some((status) => /^2\d\d$/.test(status)),
        `${where}: no 2xx`,
      ).toBe(true);
      for (const status of statuses) {
        expect(status, where).toMatch(/^[2-5]\d\d$/);
        const response = operation.responses[status];
        expect(
          response && !isReference(response) && response.description.length > 3,
          `${where} ${status}`,
        ).toBe(true);
      }
    }
  });

  it('documents the headers a request needs', () => {
    for (const { operation } of all) {
      for (const parameter of operation.parameters ?? []) {
        if (isReference(parameter)) continue;
        expect(parameter.description?.length ?? 0).toBeGreaterThan(10);
        if (parameter.in === 'path') expect(parameter.required).toBe(true);
      }
    }
    const create = doc.paths['/generations']?.post;
    const names = (create?.parameters ?? []).map((p) => (isReference(p) ? '' : p.name));
    expect(names).toContain('Idempotency-Key');
  });

  it('states who may call it, consistently with its security', () => {
    for (const { method, path, operation } of all) {
      const where = `${method.toUpperCase()} ${path}`;
      const schemes = operation.security.flatMap((requirement) => Object.keys(requirement));
      if (operation['x-session-only']) {
        expect(operation.security, where).toEqual([{ cookieAuth: [] }]);
      }
      if (operation.security.length === 0) expect(schemes, where).toEqual([]);
      for (const scheme of schemes)
        expect(doc.components.securitySchemes[scheme], where).toBeDefined();
    }
    expect(doc.paths['/models']?.get?.security).toContainEqual({});
    expect(doc.paths['/explore']?.get?.security).toEqual([]);
    expect(doc.paths['/generations']?.post?.security).toEqual([
      { bearerAuth: [] },
      { cookieAuth: [] },
    ]);
    expect(doc.paths['/keys']?.post?.['x-session-only']).toBe(true);
    expect(doc.paths['/account/password']?.post?.['x-session-only']).toBe(true);
  });

  it('documents the budget of every rate-limited operation', () => {
    for (const { method, path, operation } of all) {
      for (const limit of operation['x-rate-limit'] ?? []) {
        expect(Number.isInteger(limit.limit) && limit.limit > 0, `${method} ${path}`).toBe(true);
        expect(Number.isInteger(limit.windowSec) && limit.windowSec > 0).toBe(true);
        expect(limit.bucket.length).toBeGreaterThan(2);
      }
    }
    expect(doc.paths['/generations']?.post?.['x-rate-limit']).toEqual([
      { limit: 30, windowSec: 60, scope: 'user', bucket: 'generations-create' },
    ]);
  });
});

describe('errors', () => {
  const body = doc.components.schemas.ErrorBody as JsonSchema;

  it('are one envelope with a documented code', () => {
    expect(body.required).toEqual(['error']);
    const code = doc.components.schemas.ErrorCode as JsonSchema;
    expect(code.enum).toEqual([...ERROR_CODES]);
    expect(code['x-enum-statuses']).toEqual(ERROR_STATUS);
    const descriptions = code['x-enum-descriptions'] as Record<string, string>;
    for (const name of ERROR_CODES) expect(descriptions[name]?.length, name).toBeGreaterThan(20);
  });

  it('are described with the status of their code and a valid example', () => {
    const statusOfSpecial = new Set([416]);
    let checked = 0;
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of HTTP_METHODS) {
        for (const [status, response] of Object.entries(item[method]?.responses ?? {})) {
          if (isReference(response) || Number(status) < 400) continue;
          const media = response.content?.['application/json'];
          expect(media?.schema, `${method} ${path} ${status}`).toEqual({
            $ref: '#/components/schemas/ErrorBody',
          });
          expect(problemsOf(media?.schema as JsonSchema, media?.example, doc)).toEqual([]);
          const code = (media?.example as { error: { code: keyof typeof ERROR_STATUS } }).error
            .code;
          if (!statusOfSpecial.has(Number(status))) {
            expect(ERROR_STATUS[code], `${method} ${path} ${status}`).toBe(Number(status));
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it('give every authenticated operation a 401 and every limited one a 429', () => {
    for (const { method, path, operation } of operations()) {
      const where = `${method.toUpperCase()} ${path}`;
      if (
        operation.security.length > 0 &&
        !operation.security.some((r) => Object.keys(r).length === 0)
      ) {
        expect(operation.responses['401'], where).toBeDefined();
      }
      if (operation['x-rate-limit']) expect(operation.responses['429'], where).toBeDefined();
    }
  });
});

describe('examples', () => {
  it('all match the schema they illustrate', () => {
    let checked = 0;
    const problems: string[] = [];
    for (const { method, path, operation } of operations()) {
      const where = `${method.toUpperCase()} ${path}`;
      const media = [
        ...Object.values(operation.requestBody?.content ?? {}).map((m) => ({ m, kind: 'request' })),
        ...Object.entries(operation.responses).flatMap(([status, response]) =>
          isReference(response)
            ? []
            : Object.values(response.content ?? {}).map((m) => ({ m, kind: `response ${status}` })),
        ),
      ];
      for (const { m, kind } of media) {
        if (m.example === undefined || m.schema === undefined) continue;
        if (JSON.stringify(m.schema).includes('"binary"')) continue;
        checked += 1;
        for (const problem of problemsOf(m.schema, m.example, doc))
          problems.push(`${where} ${kind}: ${problem}`);
      }
      for (const parameter of operation.parameters ?? []) {
        if (isReference(parameter) || parameter.example === undefined) continue;
        checked += 1;
        for (const problem of problemsOf(
          parameter.schema,
          parameter.example,
          doc,
          parameter.name,
        )) {
          problems.push(`${where} parameter: ${problem}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(80);
    expect(problems).toEqual([]);
  });
});

describe('the real request schemas', () => {
  const schemas = doc.components.schemas as Record<string, JsonSchema>;

  it('are the ones the routes validate with', () => {
    const create = schemas.CreateGenerationRequest;
    expect(create?.required).toEqual(['tool', 'modelId', 'prompt']);
    expect(create?.additionalProperties).toBe(false);
    expect(create?.properties?.tool?.enum).toEqual([
      'text-to-image',
      'image-to-image',
      'text-to-video',
      'image-to-video',
    ]);
    expect(create?.properties?.prompt?.maxLength).toBe(4000);
    expect(create?.properties?.params?.additionalProperties).toBe(false);
    expect(schemas.EnhancePromptRequest?.properties?.prompt?.maxLength).toBe(2000);
    expect(schemas.ChangePasswordRequest?.required).toEqual(['currentPassword', 'newPassword']);
  });

  it('carry descriptions the routes do not', () => {
    const create = schemas.CreateGenerationRequest as JsonSchema;
    expect(create.properties?.prompt?.description).toContain('What to create');
    expect(create.properties?.params?.properties?.count?.description).toContain('maxCount');
  });

  it('accept the documented request examples and refuse an unknown field', () => {
    const create = doc.paths['/generations']?.post?.requestBody?.content['application/json'];
    expect(problemsOf(create?.schema as JsonSchema, create?.example, doc)).toEqual([]);
    expect(
      problemsOf(create?.schema as JsonSchema, { ...(create?.example as object), tipo: 'x' }, doc),
    ).toEqual(['$: unexpected property "tipo"']);
  });

  it('keep responses open and requests closed', () => {
    expect(schemas.Generation?.additionalProperties).toBeUndefined();
    expect(schemas.Generation?.required).toEqual(
      expect.arrayContaining(['id', 'status', 'outputs', 'cost']),
    );
    expect(schemas.UpdateGenerationRequest?.additionalProperties).toBe(false);
    expect(schemas.UpdateGenerationRequest?.minProperties).toBe(1);
  });
});

describe('pagination envelopes', () => {
  it('mark lists as pages and single results as data', () => {
    const list = doc.paths['/generations']?.get?.responses['200'];
    const one = doc.paths['/generations/{id}']?.get?.responses['200'];
    const schemaOf = (response: unknown) =>
      (response as { content: Record<string, { schema: JsonSchema }> }).content['application/json']
        ?.schema;
    expect(schemaOf(list)?.['x-envelope']).toBe('page');
    expect(schemaOf(list)?.required).toEqual(['data', 'nextCursor']);
    expect(schemaOf(one)?.['x-envelope']).toBe('data');
  });
});

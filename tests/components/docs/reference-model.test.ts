import { describe, expect, it } from 'vitest';
import {
  accessKind,
  budgetText,
  errorRows,
  groupParameters,
  objectSchemaIds,
  operationAnchor,
  pathSegments,
  referenceGroups,
  returnsOf,
  schemaAnchor,
  statusPhrase,
  successRows,
  tagAnchor,
} from '@/components/docs/reference-model';
import { buildOpenApiDocument } from '@/lib/openapi/spec';
import { isReference, type OperationObject, type ResponseObject } from '@/lib/openapi/types';

const doc = buildOpenApiDocument('https://aivore.example');
const op = (
  path: string,
  method: 'get' | 'post' | 'patch' | 'delete' | 'head',
): OperationObject => {
  const found = doc.paths[path]?.[method];
  if (!found) throw new Error(`no ${method} ${path}`);
  return found;
};
const response = (path: string, method: 'get' | 'post', status: string): ResponseObject => {
  const found = op(path, method).responses[status];
  if (!found || isReference(found)) throw new Error('no response');
  return found;
};

describe('accessKind', () => {
  it('reads who may call from the security alternatives', () => {
    expect(accessKind(op('/generations', 'post'))).toBe('any');
    expect(accessKind(op('/models', 'get'))).toBe('optional');
    expect(accessKind(op('/explore', 'get'))).toBe('public');
    expect(accessKind(op('/keys', 'post'))).toBe('session');
  });
});

describe('anchors', () => {
  it('are stable, lower case and free of spaces', () => {
    expect(operationAnchor('createGeneration')).toBe('op-createGeneration');
    expect(tagAnchor('Uploads and media')).toBe('ref-uploads-and-media');
    expect(tagAnchor('Sessions and sign-in')).toBe('ref-sessions-and-sign-in');
    expect(schemaAnchor('Generation')).toBe('schema-Generation');
  });
});

describe('pathSegments', () => {
  it('sets the parameters apart from the literal text', () => {
    expect(pathSegments('/generations/{id}/cancel')).toEqual([
      { text: '/generations/', parameter: false },
      { text: '{id}', parameter: true },
      { text: '/cancel', parameter: false },
    ]);
    expect(pathSegments('/models')).toEqual([{ text: '/models', parameter: false }]);
  });
});

describe('budgetText', () => {
  it('says the budget the way a person would', () => {
    expect(budgetText({ limit: 30, windowSec: 60, scope: 'user', bucket: 'x' })).toBe(
      '30 requests per minute, per account',
    );
    expect(budgetText({ limit: 3, windowSec: 86_400, scope: 'user', bucket: 'x' })).toBe(
      '3 requests per day, per account',
    );
    expect(budgetText({ limit: 10, windowSec: 3_600, scope: 'address', bucket: 'x' })).toBe(
      '10 requests per hour, per IP address',
    );
    expect(
      budgetText({ limit: 5, windowSec: 90, scope: 'user-or-address', bucket: 'x' }),
    ).toContain('per 90 seconds');
  });
});

describe('statusPhrase', () => {
  it('names the statuses the document uses', () => {
    for (const status of [
      200, 201, 202, 204, 206, 304, 400, 401, 402, 403, 404, 409, 413, 415, 416, 422, 429, 502, 503,
    ]) {
      expect(statusPhrase(status), String(status)).not.toBe('');
    }
    expect(statusPhrase(299)).toBe('');
  });

  it('covers every status the document declares', () => {
    for (const item of Object.values(doc.paths)) {
      for (const operation of Object.values(item)) {
        for (const status of Object.keys(operation.responses)) {
          expect(statusPhrase(Number(status)), status).not.toBe('');
        }
      }
    }
  });
});

describe('returnsOf', () => {
  it('names what a response carries', () => {
    expect(returnsOf(response('/generations', 'post', '201'))).toEqual({
      kind: 'object',
      ref: 'Generation',
      nullable: false,
    });
    expect(returnsOf(response('/generations', 'get', '200'))).toEqual({
      kind: 'page',
      ref: 'Generation',
    });
    expect(returnsOf(response('/models', 'get', '200'))).toEqual({ kind: 'array', ref: 'Model' });
    expect(returnsOf(response('/auth/me', 'get', '200'))).toEqual({
      kind: 'object',
      ref: 'User',
      nullable: true,
    });
  });

  it('knows a file and an empty answer', () => {
    expect(returnsOf(response('/media/{assetId}', 'get', '200'))).toEqual({
      kind: 'file',
      types: ['image/*', 'video/*'],
    });
    expect(returnsOf(response('/media/{assetId}', 'get', '304'))).toEqual({ kind: 'none' });
  });
});

describe('errorRows and successRows', () => {
  it('split the responses and read the code from the example', () => {
    const create = op('/generations', 'post');
    expect(successRows(create).map((row) => row.status)).toEqual([200, 201]);
    const errors = errorRows(create);
    expect(errors.map((row) => row.status)).toEqual(
      [...errors.map((row) => row.status)].sort((a, b) => a - b),
    );
    expect(errors.find((row) => row.status === 402)).toMatchObject({
      code: 'insufficient_credits',
    });
    expect(errors.find((row) => row.status === 422)?.code).toBe('validation_failed');
    for (const row of errors) expect(row.description.length).toBeGreaterThan(10);
  });

  it('count a 304 as a success', () => {
    expect(successRows(op('/media/{assetId}', 'get')).map((row) => row.status)).toEqual([
      200, 206, 304,
    ]);
  });
});

describe('groupParameters', () => {
  it('orders path, query and header and drops the empty groups', () => {
    expect(groupParameters(op('/generations/{id}', 'get')).map((group) => group.location)).toEqual([
      'path',
    ]);
    expect(groupParameters(op('/generations', 'get')).map((group) => group.location)).toEqual([
      'query',
    ]);
    expect(groupParameters(op('/media/{assetId}', 'get')).map((group) => group.location)).toEqual([
      'path',
      'query',
      'header',
    ]);
    expect(groupParameters(op('/models', 'get'))).toEqual([]);
  });
});

describe('referenceGroups', () => {
  const groups = referenceGroups(doc);

  it('follows the order of the tags and leaves out empty ones', () => {
    expect(groups.map((group) => group.tag)).toEqual(doc.tags.map((tag) => tag.name));
  });

  it('lists each operation once, in the order they were written', () => {
    const all = groups.flatMap((group) => group.operations);
    expect(all).toHaveLength(
      Object.values(doc.paths).reduce((sum, item) => sum + Object.keys(item).length, 0),
    );
    expect(new Set(all.map((entry) => entry.id)).size).toBe(all.length);
    const generations = groups[0]?.operations.map((entry) => entry.id);
    expect(generations).toEqual([
      'createGeneration',
      'listGenerations',
      'getGeneration',
      'updateGeneration',
      'deleteGeneration',
      'cancelGeneration',
    ]);
  });
});

describe('objectSchemaIds', () => {
  it('lists the response objects and not the request bodies', () => {
    const ids = objectSchemaIds(doc);
    expect(ids).toEqual(
      expect.arrayContaining(['User', 'Generation', 'Asset', 'Model', 'ApiKey', 'ErrorBody']),
    );
    expect(ids.some((id) => id.endsWith('Request'))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { curlFor } from '@/lib/openapi/curl';
import type { EndpointSpec } from '@/lib/openapi/operation';
import { buildOpenApiDocument, listEndpointSpecs } from '@/lib/openapi/spec';

const ORIGIN = 'https://aivore.example';
const doc = buildOpenApiDocument(ORIGIN);
const sample = (path: string, method: 'get' | 'post' | 'patch' | 'delete' | 'head') =>
  doc.paths[path]?.[method]?.['x-codeSamples']?.[0]?.source ?? '';
const spec = (operationId: string): EndpointSpec => {
  const found = listEndpointSpecs().find((endpoint) => endpoint.operationId === operationId);
  if (!found) throw new Error(`no endpoint ${operationId}`);
  return found;
};

describe('the cURL example of every operation', () => {
  it('is in the document as an x-codeSamples entry', () => {
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const source = operation['x-codeSamples']?.[0]?.source;
        expect(source, `${method} ${path}`).toMatch(/^curl /);
        // The literal part of the path, up to the first `{id}`, is in the URL.
        expect(source).toContain(`${ORIGIN}/api/v1${path.split('{')[0]}`);
        expect(operation['x-codeSamples']?.[0]).toMatchObject({ lang: 'Shell', label: 'cURL' });
      }
    }
  });

  it('puts example ids into the path', () => {
    expect(sample('/generations/{id}', 'get')).toContain(
      '/generations/gen_01k8m3x9q2v7c5n4h6j0t1r8we"',
    );
    expect(sample('/keys/{id}', 'delete')).toContain('/keys/key_');
    expect(sample('/media/{assetId}', 'get')).toContain('/media/ast_');
  });

  it('sends an API key where a key is accepted, nothing where credentials are optional', () => {
    expect(sample('/generations', 'post')).toContain('Authorization: Bearer $AIVORE_API_KEY');
    expect(sample('/models', 'get')).not.toContain('Authorization');
    expect(sample('/explore', 'get')).not.toContain('Authorization');
  });

  it('shows the cookie jar and the Origin header for browser-only endpoints', () => {
    for (const [path, method] of [
      ['/keys', 'post'],
      ['/keys', 'get'],
      ['/account/password', 'post'],
    ] as const) {
      expect(sample(path, method), `${method} ${path}`).toContain('-b cookies.txt');
      expect(sample(path, method)).not.toContain('Bearer');
    }
    expect(sample('/keys', 'post')).toContain('Origin: https://aivore.example');
    expect(sample('/keys', 'get')).not.toContain('Origin');
  });

  it('saves the session cookie when signing in and sends it when signing out', () => {
    expect(sample('/auth/login', 'post')).toContain('-c cookies.txt');
    expect(sample('/auth/login', 'post')).toContain('Origin: https://aivore.example');
    expect(sample('/auth/logout', 'post')).toContain('-b cookies.txt');
  });

  it('sends JSON bodies pretty printed and quoted for the shell', () => {
    const create = sample('/generations', 'post');
    expect(create).toContain('-H "Content-Type: application/json"');
    expect(create).toContain(`-d '{\n    "tool": "text-to-image"`);
    expect(create).toContain('Idempotency-Key: ');
  });

  it('quotes a single quote inside a body', () => {
    const custom: EndpointSpec = {
      ...spec('enhancePrompt'),
      request: {
        ...spec('enhancePrompt').request!,
        example: { prompt: "it's a test", kind: 'image' },
      },
    };
    expect(curlFor(custom, ORIGIN)).toContain(`"prompt": "it'\\''s a test"`);
  });

  it('uploads a file as multipart instead of JSON', () => {
    const upload = sample('/uploads', 'post');
    expect(upload).toContain('-F "file=@photo.png"');
    expect(upload).not.toContain('Content-Type');
  });

  it('adds only the query parameters an endpoint chooses to show', () => {
    expect(sample('/generations', 'get')).toContain('?status=succeeded&limit=20"');
    expect(sample('/account/ledger', 'get')).toContain('?limit=20"');
    expect(sample('/models', 'get')).not.toContain('?');
  });

  it('downloads a file with its own name, and inspects one with HEAD', () => {
    expect(sample('/media/{assetId}', 'get')).toMatch(/^curl -OJ .*download=1/);
    expect(sample('/media/{assetId}', 'head')).toMatch(/^curl -I /);
  });

  it('uses the origin it is given', () => {
    expect(curlFor(spec('listModels'), 'http://localhost:3000')).toBe(
      'curl "http://localhost:3000/api/v1/models"',
    );
  });
});

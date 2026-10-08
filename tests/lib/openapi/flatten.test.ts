import { describe, expect, it } from 'vitest';
import { flattenSchema } from '@/lib/openapi/flatten';
import { buildOpenApiDocument } from '@/lib/openapi/spec';
import type { JsonSchema } from '@/lib/openapi/types';

const doc = buildOpenApiDocument('https://aivore.example');
const ref = (id: string): JsonSchema => ({ $ref: `#/components/schemas/${id}` });
const rowsOf = (schema: JsonSchema) => flattenSchema(schema, doc);
const byName = (schema: JsonSchema) =>
  Object.fromEntries(rowsOf(schema).map((row) => [row.name, row]));

describe('flattenSchema', () => {
  it('lists the fields of a request in order, marking the required ones', () => {
    const rows = rowsOf(ref('CreateGenerationRequest'));
    expect(rows.map((row) => row.name).slice(0, 5)).toEqual([
      'tool',
      'modelId',
      'prompt',
      'negativePrompt',
      'params',
    ]);
    expect(rows.filter((row) => row.required).map((row) => row.name)).toEqual([
      'tool',
      'modelId',
      'prompt',
    ]);
  });

  it('expands nested objects with dotted names and a depth', () => {
    const rows = byName(ref('CreateGenerationRequest'));
    expect(rows['params.count']).toMatchObject({ depth: 1, type: 'integer', required: false });
    expect(rows['params.count']?.constraints).toEqual(['1 to 8']);
    expect(rows['params.aspectRatio']?.enumValues).toContain('16:9');
  });

  it('turns bounds and defaults into words', () => {
    const rows = byName(ref('CreateGenerationRequest'));
    expect(rows.prompt?.constraints).toEqual(['1 to 4000 characters']);
    expect(rows.negativePrompt?.constraints).toEqual(['at most 2000 characters']);
    expect(rows['params.seed']?.constraints).toEqual(['0 to 4294967295']);
  });

  it('keeps the descriptions the document carries', () => {
    expect(byName(ref('CreateGenerationRequest')).prompt?.description).toContain('What to create');
  });

  it('does not expand a field that is a component, but links to it', () => {
    const rows = byName(ref('Generation'));
    expect(rows.outputs).toMatchObject({ type: 'Asset[]', ref: 'Asset', required: true });
    expect(rows.input).toMatchObject({ type: 'Asset', ref: 'Asset', required: false });
    expect(Object.keys(rows).some((name) => name.startsWith('outputs.'))).toBe(false);
  });

  it('expands an inline object', () => {
    const rows = byName(ref('Generation'));
    expect(rows['error.code']).toMatchObject({ depth: 1, type: 'string' });
    expect(rows['owner.name']).toMatchObject({ depth: 1 });
  });

  it('unwraps the response envelope to what is inside data', () => {
    const single = doc.paths['/generations/{id}']?.get?.responses['200'];
    const list = doc.paths['/generations']?.get?.responses['200'];
    const schemaOf = (response: unknown) =>
      (response as { content: Record<string, { schema: JsonSchema }> }).content['application/json']
        ?.schema as JsonSchema;
    expect(rowsOf(schemaOf(single)).map((row) => row.name)).toContain('status');
    expect(rowsOf(schemaOf(list)).map((row) => row.name)).toContain('status');
    expect(rowsOf(schemaOf(list)).map((row) => row.name)).not.toContain('data');
  });

  it('looks past a null alternative', () => {
    const me = doc.paths['/auth/me']?.get?.responses['200'] as {
      content: Record<string, { schema: JsonSchema }>;
    };
    expect(
      rowsOf(me.content['application/json']?.schema as JsonSchema).map((row) => row.name),
    ).toContain('email');
  });

  it('lists every variant of a union, none of them required', () => {
    const rows = byName(ref('Model'));
    expect(rows.pricing).toMatchObject({ type: 'object', required: true });
    expect(rows['pricing.perImage']).toMatchObject({ required: false });
    expect(rows['pricing.perSecond.720p']).toBeDefined();
  });

  it('stops expanding at the depth it is given', () => {
    const shallow = flattenSchema(ref('Model'), doc, { maxDepth: 1 });
    expect(shallow.every((row) => row.depth === 0)).toBe(true);
  });

  it('reports a reference that points nowhere instead of guessing', () => {
    expect(() => flattenSchema(ref('Nope'), doc)).toThrow(/Unresolved/);
  });

  it('can describe every schema of the document', () => {
    for (const [id, schema] of Object.entries(doc.components.schemas)) {
      if (schema.type !== 'object') continue;
      expect(() => rowsOf(ref(id)), id).not.toThrow();
    }
  });
});

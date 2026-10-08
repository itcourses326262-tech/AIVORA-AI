import { z } from 'zod';
import { isRecord } from '@/lib/utils';
import type { JsonSchema } from './types';

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const COMPONENT_PREFIX = '#/components/schemas/';

/** Zod emits the safe-integer range for `z.int()`; it is noise in a reference. */
const SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export interface ComponentMeta {
  id: string;
  description?: string;
}

export function componentRef(id: string): JsonSchema {
  return { $ref: `${COMPONENT_PREFIX}${id}` };
}

export function componentIdOf(ref: string): string | undefined {
  return ref.startsWith(COMPONENT_PREFIX) ? ref.slice(COMPONENT_PREFIX.length) : undefined;
}

function tidy(schema: JsonSchema, io: 'input' | 'output'): JsonSchema {
  const copy: JsonSchema = { ...schema };
  delete copy.$schema;
  delete copy.$id;
  if (copy.minimum === -SAFE_INTEGER) delete copy.minimum;
  if (copy.maximum === SAFE_INTEGER) delete copy.maximum;
  // A response may gain fields without breaking clients: only request bodies are closed.
  if (io === 'output' && copy.additionalProperties === false) delete copy.additionalProperties;
  if (copy.properties) {
    copy.properties = Object.fromEntries(
      Object.entries(copy.properties).map(([name, child]) => [name, tidy(child, io)]),
    );
  }
  if (copy.items) copy.items = tidy(copy.items, io);
  for (const keyword of ['oneOf', 'anyOf', 'allOf', 'prefixItems'] as const) {
    const list = copy[keyword];
    if (list) copy[keyword] = list.map((child) => tidy(child, io));
  }
  if (isRecord(copy.additionalProperties)) {
    copy.additionalProperties = tidy(copy.additionalProperties as JsonSchema, io);
  }
  return copy;
}

/** One schema, converted for a request (`input`) or a response (`output`). */
export function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const converted = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'any',
  }) as JsonSchema;
  return tidy(converted, io);
}

/**
 * The named schemas of a document (`components.schemas`). Real request schemas are registered as
 * they are, without being modified; the names make zod emit `$ref`s wherever one is nested in
 * another. Requests and responses are converted separately because zod reads a schema differently
 * for each direction (a transform's input is what a client sends, its output what the handler gets).
 */
export class SchemaCatalog {
  private readonly registry = z.registry<ComponentMeta>();
  private readonly ids = new Set<string>();

  constructor(private readonly io: 'input' | 'output') {}

  add<S extends z.ZodType>(schema: S, meta: ComponentMeta): S {
    if (this.ids.has(meta.id)) throw new Error(`Duplicate OpenAPI schema id "${meta.id}"`);
    this.ids.add(meta.id);
    this.registry.add(schema, meta);
    return schema;
  }

  ref(id: string): JsonSchema {
    if (!this.ids.has(id)) throw new Error(`Unknown OpenAPI schema id "${id}"`);
    return componentRef(id);
  }

  schemas(): Record<string, JsonSchema> {
    const converted = z.toJSONSchema(this.registry, {
      target: 'draft-2020-12',
      io: this.io,
      unrepresentable: 'any',
      uri: (id) => `${COMPONENT_PREFIX}${id}`,
    });
    return Object.fromEntries(
      Object.entries(converted.schemas).map(([id, schema]) => [
        id,
        tidy(schema as JsonSchema, this.io),
      ]),
    );
  }
}

/**
 * Adds documentation to a converted schema without touching the zod schema it came from (the real
 * request schemas of the routes carry none). Keys are dotted property paths (`params.count`); the
 * value is the description, or a full patch.
 */
export function annotate(
  schema: JsonSchema,
  notes: Readonly<Record<string, string | Partial<JsonSchema>>>,
): JsonSchema {
  const copy = structuredClone(schema);
  for (const [path, note] of Object.entries(notes)) {
    let target: JsonSchema | undefined = copy;
    if (path !== '') {
      for (const segment of path.split('.')) {
        target = target?.properties?.[segment];
      }
    }
    if (!target) throw new Error(`annotate: no property "${path}" in the schema`);
    Object.assign(target, typeof note === 'string' ? { description: note } : note);
  }
  return copy;
}

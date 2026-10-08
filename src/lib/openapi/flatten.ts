import { componentIdOf } from './json-schema';
import type { JsonSchema, OpenApiDocument } from './types';

/** One line of a field table: a property, possibly nested (`params.count`, `outputs[].url`). */
export interface SchemaRow {
  /** Dotted path from the root of the table. */
  name: string;
  /** How deep the field sits; 0 for top-level fields. */
  depth: number;
  /** `string`, `integer`, `Asset[]`, `string | null`, `"image"`... */
  type: string;
  /** The component this field is (or is a list of): rendered as a link to its table. */
  ref?: string;
  required: boolean;
  description?: string;
  /** Allowed values of an enumeration. */
  enumValues?: string[];
  /** Bounds and defaults in words: `1 to 4000 characters`, `default 20`. */
  constraints: string[];
}

type Components = Pick<OpenApiDocument, 'components'>;

const DEFAULT_MAX_DEPTH = 3;

function resolve(schema: JsonSchema, doc: Components): JsonSchema {
  if (schema.$ref === undefined) return schema;
  const id = componentIdOf(schema.$ref);
  const target = id === undefined ? undefined : doc.components.schemas[id];
  if (!target) throw new Error(`Unresolved schema reference ${schema.$ref}`);
  return target;
}

function isNull(schema: JsonSchema): boolean {
  return schema.type === 'null';
}

function range(
  low: number | undefined,
  high: number | undefined,
  unit: string,
): string | undefined {
  if (low !== undefined && high !== undefined) return `${low} to ${high}${unit}`;
  if (low !== undefined) return `at least ${low}${unit}`;
  if (high !== undefined) return `at most ${high}${unit}`;
  return undefined;
}

function constraintsOf(schema: JsonSchema): string[] {
  const list: string[] = [];
  const length = range(schema.minLength, schema.maxLength, ' characters');
  if (length) list.push(length);
  const bounds = range(schema.minimum, schema.maximum, '');
  if (bounds) list.push(bounds);
  const items = range(schema.minItems, schema.maxItems, ' items');
  if (items) list.push(items);
  if (schema.default !== undefined) list.push(`default ${JSON.stringify(schema.default)}`);
  return list;
}

interface Described {
  type: string;
  ref?: string;
  enumValues?: string[];
  /** Properties to list underneath, with the prefix they get. */
  children?: { schema: JsonSchema; prefix: string }[];
}

function scalarType(schema: JsonSchema): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const label = types.join(' | ');
  if (schema.format === 'binary') return 'file';
  return label === '' ? 'any' : label;
}

function describe(schema: JsonSchema, doc: Components, name: string): Described {
  if (schema.$ref !== undefined) {
    return { type: componentIdOf(schema.$ref) ?? schema.$ref, ref: componentIdOf(schema.$ref) };
  }
  if (schema.anyOf) {
    const present = schema.anyOf.filter((part) => !isNull(part));
    const nullable = present.length !== schema.anyOf.length;
    const suffix = nullable ? ' | null' : '';
    const only = present[0];
    if (present.length === 1 && only) {
      const inner = describe(only, doc, name);
      return { ...inner, type: `${inner.type}${suffix}` };
    }
    const objects = present.filter((part) => resolve(part, doc).type === 'object');
    if (objects.length === present.length) {
      return {
        type: `object${suffix}`,
        children: objects.map((part) => ({ schema: resolve(part, doc), prefix: name })),
      };
    }
    return {
      type: `${present.map((part) => describe(part, doc, name).type).join(' | ')}${suffix}`,
    };
  }
  if (schema.type === 'array' && schema.items) {
    const item = describe(schema.items, doc, `${name}[]`);
    return {
      type: `${item.type}[]`,
      ref: item.ref,
      enumValues: item.enumValues,
      children: item.children,
    };
  }
  if (schema.type === 'object' && schema.properties) {
    return { type: 'object', children: [{ schema, prefix: name }] };
  }
  return {
    type: scalarType(schema),
    enumValues: schema.enum?.map((value) => String(value)),
  };
}

function rowsOf(
  object: JsonSchema,
  doc: Components,
  prefix: string,
  depth: number,
  maxDepth: number,
  forceOptional: boolean,
): SchemaRow[] {
  const rows: SchemaRow[] = [];
  const required = new Set(object.required ?? []);
  for (const [key, property] of Object.entries(object.properties ?? {})) {
    const name = prefix === '' ? key : `${prefix}.${key}`;
    const described = describe(property, doc, name);
    const target = property.$ref === undefined ? property : undefined;
    rows.push({
      name,
      depth,
      type: described.type,
      ...(described.ref === undefined ? {} : { ref: described.ref }),
      required: !forceOptional && required.has(key),
      ...(property.description === undefined ? {} : { description: property.description }),
      ...(described.enumValues === undefined ? {} : { enumValues: described.enumValues }),
      constraints: target ? constraintsOf(target) : [],
    });
    if (depth + 1 < maxDepth) {
      const children = described.children ?? [];
      for (const child of children) {
        rows.push(
          ...rowsOf(child.schema, doc, child.prefix, depth + 1, maxDepth, children.length > 1),
        );
      }
    }
  }
  return rows;
}

/**
 * The fields of a schema as table rows. A reference at the top is followed; a response envelope
 * (`x-envelope`) is unwrapped to what is inside `data`. Fields that are themselves components are
 * not expanded: they get a `ref` for a link to their own table.
 */
export function flattenSchema(
  schema: JsonSchema,
  doc: Components,
  options: { maxDepth?: number } = {},
): SchemaRow[] {
  let root = unwrap(resolve(schema, doc), doc);
  if (root['x-envelope'] !== undefined) {
    const data = root.properties?.data;
    if (!data) return [];
    root = unwrap(resolve(data, doc), doc);
  }
  return rowsOf(root, doc, '', 0, options.maxDepth ?? DEFAULT_MAX_DEPTH, false);
}

/** The object a table is about: through a list's items and past `null` alternatives. */
function unwrap(schema: JsonSchema, doc: Components): JsonSchema {
  if (schema.type === 'array' && schema.items) return unwrap(resolve(schema.items, doc), doc);
  const present = schema.anyOf?.filter((part) => !isNull(part));
  if (present && present.length === 1 && present[0]) return unwrap(resolve(present[0], doc), doc);
  return schema;
}

import type { JsonSchema, OpenApiDocument } from '@/lib/openapi/types';

/**
 * A small JSON Schema (2020-12) checker for the keywords the document uses, so tests can prove
 * that examples and real route responses match the schemas they are documented with. It reports
 * every difference as `path: message`; an empty list means the value is valid.
 */
export function problemsOf(
  schema: JsonSchema,
  value: unknown,
  document: Pick<OpenApiDocument, 'components'>,
  path = '$',
): string[] {
  if (schema.$ref !== undefined) {
    const id = schema.$ref.replace('#/components/schemas/', '');
    const target = document.components.schemas[id];
    if (!target) return [`${path}: unresolved reference ${schema.$ref}`];
    return problemsOf(target, value, document, path);
  }

  const problems: string[] = [];
  const here = (message: string) => problems.push(`${path}: ${message}`);

  if (schema.allOf) {
    for (const part of schema.allOf) problems.push(...problemsOf(part, value, document, path));
  }
  if (
    schema.anyOf &&
    !schema.anyOf.some((part) => problemsOf(part, value, document, path).length === 0)
  ) {
    here(`matches none of the ${schema.anyOf.length} alternatives`);
  }
  if (schema.oneOf) {
    const matching = schema.oneOf.filter(
      (part) => problemsOf(part, value, document, path).length === 0,
    );
    if (matching.length !== 1)
      here(`matches ${matching.length} of the alternatives, expected exactly one`);
  }

  if (schema.const !== undefined && value !== schema.const)
    here(`expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value))
    here(`${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`);

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => isType(type, value))) {
      here(`expected ${types.join(' or ')}, got ${describeType(value)}`);
      return problems;
    }
  }

  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength)
      here(`shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && length > schema.maxLength)
      here(`longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value))
      here(`does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) here(`below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) here(`above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      here(`fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      here(`more than ${schema.maxItems} items`);
    if (schema.items) {
      value.forEach((item, index) =>
        problems.push(
          ...problemsOf(schema.items as JsonSchema, item, document, `${path}[${index}]`),
        ),
      );
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const name of schema.required ?? []) {
      if (!(name in record) || record[name] === undefined) here(`missing required "${name}"`);
    }
    if (schema.minProperties !== undefined && Object.keys(record).length < schema.minProperties) {
      here(`fewer than ${schema.minProperties} properties`);
    }
    for (const [name, child] of Object.entries(record)) {
      const declared = schema.properties?.[name];
      if (declared) problems.push(...problemsOf(declared, child, document, `${path}.${name}`));
      else if (schema.additionalProperties === false) here(`unexpected property "${name}"`);
      else if (typeof schema.additionalProperties === 'object') {
        problems.push(
          ...problemsOf(schema.additionalProperties, child, document, `${path}.${name}`),
        );
      }
    }
  }
  return problems;
}

function isType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return false;
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

import { describe, expect, it } from 'vitest';
import { falModels } from '@/lib/catalog/models/fal';
import type { GenerationParams, ModelSpec } from '@/lib/catalog/types';
import { getFalAdapter } from '@/server/providers/fal/adapters';
import { FAL_INPUT_SCHEMAS, type FieldRule } from './fal-input-schemas';
import { inputFor, pngImage } from './fixtures';

/** Every combination of the options a model advertises. */
function paramCombos(model: ModelSpec): Array<Partial<GenerationParams>> {
  const { limits } = model;
  const counts = Array.from({ length: limits.maxCount }, (_, index) => index + 1);
  const combos: Array<Partial<GenerationParams>> = [];
  for (const aspectRatio of limits.aspectRatios) {
    for (const count of counts) {
      for (const durationSec of limits.durations ?? [undefined]) {
        for (const resolution of limits.resolutions ?? [undefined]) {
          combos.push({
            aspectRatio,
            count,
            ...(durationSec === undefined ? {} : { durationSec }),
            ...(resolution === undefined ? {} : { resolution }),
            seed: 42,
            strength: 0.7,
          });
        }
      }
    }
  }
  return combos;
}

function conforms(field: string, value: unknown, rule: FieldRule): string | undefined {
  if (Array.isArray(rule)) {
    return rule.includes(value as string)
      ? undefined
      : `${field}=${String(value)} is not in ${rule.join('|')}`;
  }
  switch (rule) {
    case 'string':
      return typeof value === 'string' && value !== '' ? undefined : `${field} must be a string`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? undefined
        : `${field} must be a number`;
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `${field} must be a boolean`;
    case 'file':
      return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(value)
        ? undefined
        : `${field} must be a base64 data URI`;
    case 'files':
      return Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => typeof item === 'string' && item.startsWith('data:image/'))
        ? undefined
        : `${field} must be a list of data URIs`;
    case 'image_size': {
      const size = value as { width?: unknown; height?: unknown };
      return typeof value === 'object' &&
        value !== null &&
        Number.isInteger(size.width) &&
        Number.isInteger(size.height) &&
        (size.width as number) >= 64 &&
        (size.height as number) >= 64
        ? undefined
        : `${field} must be { width, height }`;
    }
    default:
      return `unknown rule for ${field}`;
  }
}

describe('request bodies conform to the published fal input schemas', () => {
  it('has a schema snapshot for exactly the catalog endpoints', () => {
    expect(Object.keys(FAL_INPUT_SCHEMAS).sort()).toEqual(
      falModels.map((model) => model.providerModel).sort(),
    );
  });

  it.each(falModels.map((model) => [model.id, model] as const))(
    '%s sends only documented fields with valid values',
    async (_id, model) => {
      const schema = FAL_INPUT_SCHEMAS[model.providerModel];
      expect(schema).toBeDefined();
      if (!schema) return;
      const adapter = getFalAdapter(model.providerModel);
      const needsImage = model.tools.some((tool) => tool.startsWith('image-to-'));
      const inputImage = needsImage
        ? { bytes: await pngImage(512, 384), mimeType: 'image/png' }
        : undefined;
      const problems = new Set<string>();

      for (const params of paramCombos(model)) {
        const input = inputFor(model.id, {
          prompt: 'a calm lake',
          negativePrompt: 'blurry',
          params,
          ...(inputImage ? { inputImage } : {}),
        });
        const body = await adapter.buildInput(input);
        for (const field of schema.required) {
          if (!(field in body)) problems.add(`missing required ${field}`);
        }
        for (const [field, value] of Object.entries(body)) {
          const rule = schema.fields[field];
          if (rule === undefined) {
            problems.add(`undocumented field ${field}`);
            continue;
          }
          const problem = conforms(field, value, rule);
          if (problem) problems.add(problem);
        }
        const count = (body as { num_images?: number }).num_images;
        if (count !== undefined) {
          expect(count).toBeGreaterThanOrEqual(1);
          expect(count).toBeLessThanOrEqual(model.limits.maxCount);
        }
      }
      expect([...problems]).toEqual([]);
    },
  );
});

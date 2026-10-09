/**
 * Turning failures into words. A failed generation carries the engine's failure code
 * (`content_policy`, `timeout`, ...); a failed request carries an API error code. Both map to
 * localized text, never to the English `message`, which is for logs.
 */
import { isApiError } from '@/lib/api-client';
import type { GenerationDTO } from '@/lib/api-types';
import type { MessageKey, TFunction } from '@/lib/i18n';
import { isRecord } from '@/lib/utils';
import { errorMessage } from '@/components/ui/error-message';

const FAILURE_CODES = [
  'content_policy',
  'invalid_input',
  'rate_limited',
  'unavailable',
  'timeout',
  'internal',
  'interrupted',
] as const;
type FailureCode = (typeof FAILURE_CODES)[number];

function isFailureCode(code: string): code is FailureCode {
  return (FAILURE_CODES as readonly string[]).includes(code);
}

const FAILURE_KEYS: Record<FailureCode, MessageKey> = {
  content_policy: 'studio.generations.failure.content_policy',
  invalid_input: 'studio.generations.failure.invalid_input',
  rate_limited: 'studio.generations.failure.rate_limited',
  unavailable: 'studio.generations.failure.unavailable',
  timeout: 'studio.generations.failure.timeout',
  internal: 'studio.generations.failure.internal',
  // Written by the job engine when it cannot tell whether a paid provider accepted the request:
  // the shared sentence already says the credits came back and that trying again is safe.
  interrupted: 'errors.interrupted',
};

/** Why a generation failed, in the user's language. */
export function failureReason(t: TFunction, generation: Pick<GenerationDTO, 'error'>): string {
  const code = generation.error?.code ?? '';
  return t(isFailureCode(code) ? FAILURE_KEYS[code] : 'studio.generations.failure.unknown');
}

/** The form fields a `validation_failed` answer can point at. */
export const FIELD_PATHS = [
  'prompt',
  'negativePrompt',
  'modelId',
  'aspectRatio',
  'count',
  'durationSec',
  'resolution',
  'seed',
  'strength',
  'inputAssetId',
] as const;
export type FieldPath = (typeof FIELD_PATHS)[number];

/** `params.count` -> `count`; null for a path that names no field of the studio form. */
export function fieldOfPath(path: string): FieldPath | null {
  const name = path.startsWith('params.') ? path.slice('params.'.length) : path;
  return (FIELD_PATHS as readonly string[]).includes(name) ? (name as FieldPath) : null;
}

/** The fields a `validation_failed` error is about (one entry per field, first issue wins). */
export function validationFields(error: unknown): FieldPath[] {
  if (!isApiError(error) || error.code !== 'validation_failed') return [];
  const issues = isRecord(error.details) ? error.details.issues : undefined;
  if (!Array.isArray(issues)) return [];
  const fields: FieldPath[] = [];
  for (const issue of issues) {
    if (!isRecord(issue) || typeof issue.path !== 'string') continue;
    const field = fieldOfPath(issue.path);
    if (field && !fields.includes(field)) fields.push(field);
  }
  return fields;
}

/** Seconds the server asks the client to wait (`rate_limited`), when it said so. */
export function retryAfterSeconds(error: unknown): number | undefined {
  if (!isApiError(error) || !isRecord(error.details)) return undefined;
  const seconds = error.details.retryAfterSec;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : undefined;
}

/** Whether the answer says the chosen model is not configured on this server. */
export function isModelUnavailable(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.code === 'conflict' &&
    isRecord(error.details) &&
    error.details.reason === 'model_unavailable'
  );
}

export { errorMessage };

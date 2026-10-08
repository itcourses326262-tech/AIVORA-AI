/**
 * What a rejected "Generate" means for the person: one localized sentence, which fields it is about,
 * and what the page should do next. The English `message` of the API is never shown.
 */
import { isApiError } from '@/lib/api-client';
import type { MessageKey, TFunction } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locales';
import {
  isModelUnavailable,
  retryAfterSeconds,
  validationFields,
  type FieldPath,
} from '@/lib/generations/errors';
import { errorMessage } from '@/components/ui/error-message';
import { formatSeconds } from '@/lib/utils';

export type SubmitProblemKind =
  /** The session ended: send the person to log in. */
  | 'login'
  /** Not enough credits: offer to get more. */
  | 'credits'
  /** The prompt was declined by moderation. */
  | 'moderation'
  /** Some fields were refused; `fields` says which. */
  | 'validation'
  /** The chosen model is not available on this server. */
  | 'model_unavailable'
  | 'rate_limited'
  /** The service is overloaded; nothing is wrong with the request. */
  | 'busy'
  | 'other';

export interface SubmitProblem {
  kind: SubmitProblemKind;
  message: string;
  fields: FieldPath[];
}

/** Every field the form can mark, mapped to its sentence. */
export const FIELD_MESSAGE_KEYS: Record<FieldPath, MessageKey> = {
  prompt: 'studio.fields.prompt',
  negativePrompt: 'studio.fields.negativePrompt',
  modelId: 'studio.fields.modelId',
  aspectRatio: 'studio.fields.aspectRatio',
  count: 'studio.fields.count',
  durationSec: 'studio.fields.durationSec',
  resolution: 'studio.fields.resolution',
  seed: 'studio.fields.seed',
  strength: 'studio.fields.strength',
  inputAssetId: 'studio.fields.inputAssetId',
};

function isServiceBusy(error: unknown): boolean {
  if (!isApiError(error)) return false;
  // `service_busy` is the engine's "too much load" answer (HTTP 503, with `retryAfterSec`).
  return error.code === 'provider_error' || error.code === 'service_busy' || error.status === 503;
}

export function describeSubmitError(t: TFunction, locale: Locale, error: unknown): SubmitProblem {
  const fallback = errorMessage(t, error);
  if (isApiError(error)) {
    if (error.code === 'unauthorized') {
      return { kind: 'login', message: t('studio.submit.sessionExpired'), fields: [] };
    }
    if (error.code === 'insufficient_credits') {
      return { kind: 'credits', message: fallback, fields: [] };
    }
    if (error.code === 'moderation_blocked') {
      return { kind: 'moderation', message: fallback, fields: ['prompt'] };
    }
    if (error.code === 'validation_failed') {
      return { kind: 'validation', message: fallback, fields: validationFields(error) };
    }
    if (error.code === 'rate_limited') {
      const seconds = retryAfterSeconds(error);
      return {
        kind: 'rate_limited',
        message:
          seconds === undefined
            ? fallback
            : t('studio.submit.rateLimited', { time: formatSeconds(seconds, locale) }),
        fields: [],
      };
    }
    if (isModelUnavailable(error)) {
      return {
        kind: 'model_unavailable',
        message: t('studio.submit.modelUnavailable'),
        fields: ['modelId'],
      };
    }
    if (isServiceBusy(error)) {
      const seconds = retryAfterSeconds(error);
      return {
        kind: 'busy',
        message:
          seconds === undefined
            ? t('studio.submit.serviceBusy')
            : t('studio.submit.serviceBusyRetry', { time: formatSeconds(seconds, locale) }),
        fields: [],
      };
    }
  }
  return { kind: 'other', message: fallback, fields: [] };
}

/**
 * Whether the same request may have been accepted anyway (the connection broke, the server failed):
 * then a retry must carry the same `Idempotency-Key`, so it cannot be charged twice.
 */
export function outcomeIsUnknown(error: unknown): boolean {
  if (!isApiError(error)) return true;
  return error.status === 0 || error.status >= 500 || error.code === 'invalid_response';
}

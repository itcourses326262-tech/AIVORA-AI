import 'server-only';
import { isRecord } from '@/lib/utils';
import { ProviderError, providerErrorFromStatus, type ProviderErrorOptions } from '../errors';
import { parseRetryAfter, type HttpFailure } from '../http';
import type { FalStatusResponse } from './schemas';

/*
 * fal reports problems in two shapes (docs: "Model Errors" and "Request Error Types"):
 *  - a model rejects the input: `{ "detail": [{ "loc": [...], "msg": "...", "type": "<code>" }] }`
 *    with HTTP 422 (content_policy_violation, image_too_small, ...). Branch on `type`, never on `msg`.
 *  - the platform fails the request: `{ "detail": "<text>", "error_type": "<code>" }`, the code is
 *    repeated in the `X-Fal-Error-Type` header.
 * The generic HTTP statuses (401/402/403/429, 5xx) are mapped by `providerErrorFromStatus`.
 * The text of `msg` and `input` can echo the prompt, so neither ever reaches a log or a user.
 */

const MAX_DETAIL_CHARS = 200;
const STATUS_ONLY = new Set([401, 402, 403, 429]);

interface Mapping {
  code: ProviderError['code'];
  /** Safe to show to users; defaults to the generic text of the code. */
  userMessage?: string;
}

const IMAGE_REJECTED = 'The input image could not be used. Try a different image.';

/** Model-side `detail[].type` codes. Anything else typed is a plain invalid_input. */
const MODEL_ERRORS: Readonly<Record<string, Mapping>> = {
  content_policy_violation: { code: 'content_policy' },
  generation_timeout: { code: 'timeout' },
  downstream_service_error: { code: 'unavailable' },
  downstream_service_unavailable: { code: 'unavailable' },
  internal_server_error: { code: 'unavailable' },
  image_too_small: {
    code: 'invalid_input',
    userMessage: 'The input image is too small for this model. Use a larger image.',
  },
  image_too_large: {
    code: 'invalid_input',
    userMessage: 'The input image is too large for this model. Use a smaller image.',
  },
  image_load_error: { code: 'invalid_input', userMessage: IMAGE_REJECTED },
  file_download_error: { code: 'invalid_input', userMessage: IMAGE_REJECTED },
  unsupported_image_format: { code: 'invalid_input', userMessage: IMAGE_REJECTED },
  face_detection_error: {
    code: 'invalid_input',
    userMessage: 'No usable face was found in the image. Try a different image.',
  },
};

/** `Object.hasOwn` guards against payload values such as "constructor" or "__proto__". */
function modelMapping(type: string): Mapping | undefined {
  return Object.hasOwn(MODEL_ERRORS, type) ? MODEL_ERRORS[type] : undefined;
}

/** Platform `error_type` / `X-Fal-Error-Type` codes. */
function platformMapping(errorType: string): Mapping | undefined {
  if (errorType === 'request_timeout' || errorType === 'startup_timeout') {
    return { code: 'timeout' };
  }
  if (errorType.startsWith('runner_') || errorType === 'internal_error') {
    return { code: 'unavailable' };
  }
  if (errorType === 'bad_request') return { code: 'invalid_input' };
  if (errorType === 'client_disconnected' || errorType === 'client_cancelled') {
    return { code: 'unknown' };
  }
  return modelMapping(errorType);
}

interface Issue {
  type: string;
  where: string;
}

function readIssues(body: unknown): Issue[] {
  if (!isRecord(body) || !Array.isArray(body.detail)) return [];
  const issues: Issue[] = [];
  for (const item of body.detail as unknown[]) {
    if (!isRecord(item) || typeof item.type !== 'string') continue;
    const where = Array.isArray(item.loc)
      ? item.loc.filter((part) => typeof part === 'string' || typeof part === 'number').join('.')
      : '';
    issues.push({ type: item.type, where });
  }
  return issues;
}

function shorten(text: string): string {
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}...` : text;
}

function build(
  mapping: Mapping,
  message: string,
  options: ProviderErrorOptions = {},
): ProviderError {
  return new ProviderError(mapping.code, message, {
    ...options,
    ...(mapping.userMessage === undefined ? {} : { userMessage: mapping.userMessage }),
  });
}

export interface InterpretedFailure {
  error: ProviderError;
  /** fal itself answered with an error payload (as opposed to a gateway or network problem). */
  reported: boolean;
}

/**
 * Turns a non-2xx fal answer into a {@link ProviderError}. Returns undefined when the body is not
 * in a fal error shape, so `httpJson` falls back to its generic status mapping.
 */
export function interpretFailure(failure: HttpFailure): InterpretedFailure | undefined {
  const { status, headers, body } = failure;
  if (STATUS_ONLY.has(status) || !isRecord(body)) return undefined;
  const detail = typeof body.detail === 'string' ? body.detail : undefined;
  const issues = readIssues(body);
  const errorType =
    headers.get('x-fal-error-type') ?? (typeof body.error_type === 'string' ? body.error_type : '');
  if (issues.length === 0 && detail === undefined && errorType === '') return undefined;

  const retryAfterMs = parseRetryAfter(headers.get('retry-after'));
  const options: ProviderErrorOptions = {
    httpStatus: status,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };

  const policy = issues.find((issue) => issue.type === 'content_policy_violation');
  if (policy) {
    const at = policy.where === '' ? '' : ` at ${policy.where}`;
    return {
      error: build(MODEL_ERRORS.content_policy_violation as Mapping, `fal flagged the input${at}`, {
        ...options,
        retryable: false,
      }),
      reported: true,
    };
  }

  const platform = errorType === '' ? undefined : platformMapping(errorType);
  if (platform) {
    return {
      error: build(platform, `fal request failed (${errorType})`, options),
      reported: true,
    };
  }

  const typed = issues.find((issue) => modelMapping(issue.type) !== undefined);
  if (typed) {
    const where = typed.where === '' ? '' : ` at ${typed.where}`;
    return {
      error: build(
        modelMapping(typed.type) as Mapping,
        `fal rejected the input (${typed.type}${where})`,
        options,
      ),
      reported: true,
    };
  }

  if (issues.length > 0 && status >= 400 && status < 500) {
    const summary = issues.map((issue) => `${issue.type}${issue.where ? `@${issue.where}` : ''}`);
    return {
      error: new ProviderError(
        'invalid_input',
        `fal rejected the input: ${shorten(summary.join(', '))}`,
        options,
      ),
      reported: true,
    };
  }

  // Neither a typed model error nor a known platform code. A bare `detail` string is also what a
  // gateway or proxy in front of fal answers with, so only a definite client-side rejection counts
  // as fal reporting the failure; a 5xx or 408 may clear up on the next request.
  return {
    error: providerErrorFromStatus(status, {
      ...(detail === undefined ? {} : { message: shorten(detail) }),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    }),
    reported: status >= 400 && status < 500 && status !== 408,
  };
}

/** `classifyError` for `httpJson`. */
export function classifyFalFailure(failure: HttpFailure): ProviderError | undefined {
  return interpretFailure(failure)?.error;
}

/** A queue status that carries `error` / `error_type`, or a FAILED-like status without either. */
export function jobFailure(status: FalStatusResponse): ProviderError {
  const errorType = status.error_type ?? '';
  const text = typeof status.error === 'string' ? status.error : '';
  if (errorType === 'content_policy_violation' || text.includes('content_policy_violation')) {
    return build(
      MODEL_ERRORS.content_policy_violation as Mapping,
      'fal flagged the input (job error)',
      { retryable: false },
    );
  }
  const mapping = errorType === '' ? undefined : platformMapping(errorType);
  if (mapping) return build(mapping, `fal request failed (${errorType})`);
  return new ProviderError('unknown', `fal request failed (${errorType || status.status})`);
}

// OWNER: providers-mock — real (shared by every adapter). Extend additively only.
import 'server-only';

export const PROVIDER_ERROR_CODES = [
  'invalid_input',
  'content_policy',
  'rate_limited',
  'unavailable',
  'timeout',
  'auth',
  'unknown',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

const DEFAULTS: Record<ProviderErrorCode, { retryable: boolean; userMessage: string }> = {
  invalid_input: {
    retryable: false,
    userMessage:
      'The generation service did not accept this request. Try different settings or a different prompt.',
  },
  content_policy: {
    retryable: false,
    userMessage: "The prompt or image was rejected by the generation service's content rules.",
  },
  rate_limited: {
    retryable: true,
    userMessage: 'The generation service is busy right now. Please try again shortly.',
  },
  unavailable: {
    retryable: true,
    userMessage: 'The generation service is temporarily unavailable. Please try again.',
  },
  timeout: {
    retryable: true,
    userMessage: 'The generation took too long and was stopped.',
  },
  // Credential and billing problems are ours to fix; do not tell users which key is wrong.
  auth: {
    retryable: false,
    userMessage: 'The generation service is not available right now.',
  },
  unknown: {
    retryable: false,
    userMessage: 'The generation failed unexpectedly.',
  },
};

export interface ProviderErrorOptions {
  /** Overrides the default for `code` (rate limits, timeouts and 5xx retry; everything else does not). */
  retryable?: boolean;
  /** Text that is safe to show to end users. Defaults to a generic message for `code`. */
  userMessage?: string;
  /** Upstream HTTP status, when the error came from a response. */
  httpStatus?: number;
  /** Server-suggested wait before retrying (`Retry-After`). */
  retryAfterMs?: number;
  cause?: unknown;
}

/**
 * Every failure an adapter reports. `message` is for logs and developers and may contain upstream
 * detail; only `userMessage` may be shown to users or stored on the generation.
 */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;

  constructor(code: ProviderErrorCode, message: string, options: ProviderErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.retryable = options.retryable ?? DEFAULTS[code].retryable;
    this.userMessage = options.userMessage ?? DEFAULTS[code].userMessage;
    if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}

export interface HttpFailureDetail {
  /** Short upstream explanation for logs. */
  message?: string;
  /** The response payload says the content-safety system rejected the request. */
  contentPolicy?: boolean;
  retryAfterMs?: number;
  cause?: unknown;
}

/**
 * Maps a non-2xx upstream status to a {@link ProviderError} (section 6.4): 401/402/403 auth, 408
 * timeout, 429 rate limited, 5xx unavailable (retryable), content-policy payloads content_policy,
 * the remaining 400/413/415/422 invalid_input and any other status unknown.
 */
export function providerErrorFromStatus(
  status: number,
  detail: HttpFailureDetail = {},
): ProviderError {
  const suffix = detail.message ? `: ${detail.message}` : '';
  const options: ProviderErrorOptions = {
    httpStatus: status,
    ...(detail.retryAfterMs === undefined ? {} : { retryAfterMs: detail.retryAfterMs }),
    ...(detail.cause === undefined ? {} : { cause: detail.cause }),
  };
  const make = (code: ProviderErrorCode) =>
    new ProviderError(code, `Provider responded with HTTP ${status}${suffix}`, options);

  if (detail.contentPolicy && status >= 400 && status < 500 && status !== 429) {
    return make('content_policy');
  }
  if (status === 401 || status === 402 || status === 403) return make('auth');
  if (status === 408) return make('timeout');
  if (status === 429) return make('rate_limited');
  if (status >= 500) return make('unavailable');
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return make('invalid_input');
  }
  return make('unknown');
}

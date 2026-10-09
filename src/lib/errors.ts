/**
 * Error vocabulary shared by the server and the browser.
 *
 * Server code throws {@link AppError}; the HTTP layer turns it into the `{ error }` envelope and the
 * UI maps `code` to localized text through the `errors.<code>` i18n keys (the `message` itself is
 * always English and meant for developers and logs).
 */

/** Default HTTP status per application error code. */
export const ERROR_STATUS = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  moderation_blocked: 422,
  insufficient_credits: 402,
  rate_limited: 429,
  too_many_active: 429,
  signup_disabled: 403,
  email_not_verified: 403,
  email_not_allowed: 422,
  signup_limit: 429,
  password_not_set: 409,
  provider_error: 502,
  service_busy: 503,
  internal: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** Codes produced by the browser-side API client itself, never by the server. */
export const CLIENT_ERROR_CODES = ['network_error', 'invalid_response'] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

/**
 * Failure codes only a FAILED generation carries (`GenerationDTO.error.code`): the job runner writes
 * them, no request ever fails with them. `interrupted`: a paid provider's submit was in flight when
 * the worker died, so the job was stopped (and refunded) rather than submitted a second time. Their
 * text lives in the `errors` namespace next to the request errors.
 */
export const GENERATION_FAILURE_CODES = ['interrupted'] as const;
export type GenerationFailureCode = (typeof GENERATION_FAILURE_CODES)[number];

/** Every code the UI can be asked to display. */
export type AnyErrorCode = ErrorCode | ClientErrorCode;

export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_STATUS, value);
}

export function isAnyErrorCode(value: unknown): value is AnyErrorCode {
  return (
    isErrorCode(value) ||
    (typeof value === 'string' && (CLIENT_ERROR_CODES as readonly string[]).includes(value))
  );
}

export function defaultStatus(code: ErrorCode): number {
  return ERROR_STATUS[code];
}

export class AppError extends Error {
  override readonly name: string = 'AppError';

  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }

  /** Builds an error with the default status of `code`. */
  static of(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(code, ERROR_STATUS[code], message, details);
  }
}

/** Marks a code path that an owner has not implemented yet. Surfaces as a 501 `internal` error. */
export class NotImplementedError extends AppError {
  override readonly name: string = 'NotImplementedError';

  constructor(feature: string) {
    super('internal', 501, `Not implemented: ${feature}`);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Best-effort extraction of a displayable error code from anything that was thrown. Understands
 * {@link AppError} and the browser `ApiError` (both expose a string `code`); anything else is `internal`.
 */
export function errorCodeOf(error: unknown): AnyErrorCode {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    if (isAnyErrorCode(code)) return code;
  }
  return 'internal';
}

/** Maps an HTTP status without a recognizable envelope to the closest application code. */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 402:
      return 'insufficient_credits';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 422:
      return 'validation_failed';
    case 429:
      return 'rate_limited';
    default:
      return status >= 400 && status < 500 ? 'bad_request' : 'internal';
  }
}

import type { ErrorCode } from '@/lib/errors';

export interface ErrorCodeDoc {
  /** One sentence for the error table: what the code means and what to do about it. */
  meaning: string;
  /** The English `message` shown in examples. */
  sample: string;
}

/**
 * Typed as a record over every `ErrorCode`, so adding a code to `lib/errors.ts` is a compile error
 * until it is explained here (and then it shows up in the document and the docs page).
 */
export const ERROR_CODE_DOCS: Record<ErrorCode, ErrorCodeDoc> = {
  bad_request: {
    meaning:
      'The request could not be understood or cannot be done in the current state, for example a malformed JSON body or a range that cannot be served. `details.reason` says more for some errors.',
    sample: 'Request body is not valid JSON',
  },
  validation_failed: {
    meaning:
      'A field is missing or not allowed. `details.issues` lists every problem with the field `path` and a message.',
    sample: 'Request validation failed',
  },
  unauthorized: {
    meaning:
      'No valid credentials: the key is wrong, revoked or missing, or the session has ended.',
    sample: 'Authentication required',
  },
  forbidden: {
    meaning:
      'The credentials are valid but not allowed here: an API key on a browser-only endpoint, a missing or foreign `Origin` on a cookie-authenticated change, or a disabled account.',
    sample: 'This endpoint needs a browser session',
  },
  not_found: {
    meaning:
      'The resource does not exist, or belongs to someone else (the two look the same on purpose).',
    sample: 'Generation not found',
  },
  conflict: {
    meaning:
      'The request clashes with the current state: the model is not configured on this deployment, an `Idempotency-Key` was reused for a different request, the generation is already finished, or the key limit is reached.',
    sample: 'This generation has already finished',
  },
  payload_too_large: {
    meaning: 'The request body or the uploaded file is larger than the limit of the endpoint.',
    sample: 'Request body is too large',
  },
  unsupported_media_type: {
    meaning: 'The content type is not supported: send JSON, or PNG, JPEG or WebP for uploads.',
    sample: 'Only PNG, JPEG and WebP images are accepted',
  },
  moderation_blocked: {
    meaning:
      'The prompt goes against the content policy. Nothing was charged. `details.category` names the rule.',
    sample: 'This prompt is not allowed',
  },
  insufficient_credits: {
    meaning: 'The balance does not cover the cost. `details` holds `required` and `balance`.',
    sample: 'Not enough credits',
  },
  rate_limited: {
    meaning:
      'Too many requests. Wait `details.retryAfterSec` seconds (also the `Retry-After` header), then try again.',
    sample: 'Too many requests',
  },
  too_many_active: {
    meaning:
      'You already have the maximum number of generations running at once. Wait for one to finish or cancel one.',
    sample: 'Too many generations are running',
  },
  signup_disabled: {
    meaning: 'New registrations are closed on this deployment.',
    sample: 'Registration is closed',
  },
  email_not_verified: {
    meaning:
      'The deployment requires a confirmed email address before generating. Ask for a new link with `POST /auth/verify-email/request`.',
    sample: 'Confirm your email first',
  },
  email_not_allowed: {
    meaning: 'Throwaway email domains cannot register.',
    sample: 'This email domain cannot be used',
  },
  signup_limit: {
    meaning: 'Too many accounts were created from the same network today. Try again tomorrow.',
    sample: 'Too many sign-ups from this network',
  },
  provider_error: {
    meaning:
      'The generation provider could not be reached or answered with an error. Nothing was charged. Retry later.',
    sample: 'The provider is unavailable',
  },
  service_busy: {
    meaning:
      'The platform is deliberately refusing new paid generations for a while (cost protection). Retry after `details.retryAfterSec`. Nothing was charged.',
    sample: 'The service is busy, try again later',
  },
  internal: {
    meaning: 'Something went wrong on our side. The `X-Request-Id` header identifies the request.',
    sample: 'Internal server error',
  },
};

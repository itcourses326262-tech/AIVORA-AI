import 'server-only';
import { isAppError } from '@/lib/errors';
import type { GenerationFailure } from '@/server/generations/lifecycle';
import { isProviderError, type ProviderErrorCode } from '@/server/providers/errors';

/** The error codes a failed generation can carry (`GenerationDTO.error.code`). */
export type FailureCode =
  'invalid_input' | 'content_policy' | 'rate_limited' | 'unavailable' | 'timeout' | 'internal';

/** A failure the runner decided on itself, with text that is safe to show to the user. */
export class JobFailure extends Error {
  override readonly name = 'JobFailure';

  constructor(
    readonly code: FailureCode,
    /** Shown to the user. */
    message: string,
  ) {
    super(message);
  }
}

export const UNEXPECTED_FAILURE: GenerationFailure = {
  code: 'internal',
  message: 'The generation failed unexpectedly.',
};

export const TIMEOUT_FAILURE: GenerationFailure = {
  code: 'timeout',
  message: 'The generation took too long and was stopped.',
};

// Credential problems are ours to fix: users see "unavailable", never which key is wrong.
const PROVIDER_CODES: Record<ProviderErrorCode, FailureCode> = {
  invalid_input: 'invalid_input',
  content_policy: 'content_policy',
  rate_limited: 'rate_limited',
  unavailable: 'unavailable',
  timeout: 'timeout',
  auth: 'unavailable',
  unknown: 'internal',
};

export type FailureSeverity = 'info' | 'warn' | 'error';

export interface DescribedFailure {
  failure: GenerationFailure;
  /** How loudly to log it: a refusal is routine, an outage deserves attention, a bug an alarm. */
  severity: FailureSeverity;
}

const PROVIDER_SEVERITY: Record<ProviderErrorCode, FailureSeverity> = {
  invalid_input: 'info',
  content_policy: 'info',
  rate_limited: 'warn',
  unavailable: 'warn',
  timeout: 'warn',
  unknown: 'warn',
  // Rejected credentials or an empty account: only the operator can fix this.
  auth: 'error',
};

/**
 * Turns anything thrown while running a job into what is stored and shown. Only text we wrote or
 * a provider's `userMessage` reaches the user; messages of other errors may carry upstream detail
 * and are left to the log.
 */
export function describeFailure(error: unknown): DescribedFailure {
  if (error instanceof JobFailure) {
    return { failure: { code: error.code, message: error.message }, severity: 'info' };
  }
  if (isProviderError(error)) {
    return {
      failure: { code: PROVIDER_CODES[error.code], message: error.userMessage },
      severity: PROVIDER_SEVERITY[error.code],
    };
  }
  if (isAppError(error) && error.code === 'payload_too_large') {
    return {
      failure: { code: 'unavailable', message: 'The generation result was too large to keep.' },
      severity: 'warn',
    };
  }
  return { failure: UNEXPECTED_FAILURE, severity: 'error' };
}

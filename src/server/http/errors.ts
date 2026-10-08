import 'server-only';
import { ZodError } from 'zod';
import type { ApiErrorBody, ValidationDetails } from '@/lib/api-types';
import { AppError, isAppError } from '@/lib/errors';
import { isRecord } from '@/lib/utils';

/** `validation_failed` (422) carrying one `{ path, message }` per problem. */
export function validationError(error: ZodError): AppError {
  const details: ValidationDetails = {
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
  return new AppError('validation_failed', 422, 'Request validation failed', details);
}

export interface NormalizedError {
  status: number;
  body: ApiErrorBody;
  /** Seconds to wait, for `rate_limited` and `service_busy` errors that know it. */
  retryAfterSec?: number;
}

const INTERNAL_MESSAGE = 'Internal server error';

/**
 * Maps anything thrown to the public error envelope. `internal` errors and unknown throwables
 * are reported with a generic message so implementation details never leak to clients.
 */
export function normalizeError(thrown: unknown): NormalizedError {
  const error = thrown instanceof ZodError ? validationError(thrown) : thrown;
  if (!isAppError(error)) {
    return {
      status: 500,
      body: { error: { code: 'internal', message: INTERNAL_MESSAGE } },
    };
  }
  const exposeMessage = error.code !== 'internal';
  const retryAfter =
    (error.code === 'rate_limited' || error.code === 'service_busy') && isRecord(error.details)
      ? error.details.retryAfterSec
      : undefined;
  return {
    status: error.status,
    body: {
      error: {
        code: error.code,
        message: exposeMessage ? error.message : INTERNAL_MESSAGE,
        ...(exposeMessage && error.details !== undefined ? { details: error.details } : {}),
      },
    },
    ...(typeof retryAfter === 'number' ? { retryAfterSec: retryAfter } : {}),
  };
}

/** The envelope as a `Response`; sets `Retry-After` when the error carries it. */
export function errorResponse(error: unknown): Response {
  const { status, body, retryAfterSec } = normalizeError(error);
  const response = Response.json(body, { status });
  if (retryAfterSec !== undefined) response.headers.set('Retry-After', String(retryAfterSec));
  return response;
}

import 'server-only';
import type { Env } from '@/server/env';
import { isProviderError, ProviderError } from '../errors';
import { httpJson } from '../http';
import type { ProviderContext } from '../types';
import { classifyFalFailure, interpretFailure } from './errors';
import {
  resultSchema,
  statusResponseSchema,
  submitResponseSchema,
  type FalMeta,
  type FalResult,
  type FalStatusResponse,
} from './schemas';

/*
 * fal queue protocol, as implemented by the official @fal-ai/client:
 *   POST  https://queue.fal.run/{endpoint}                  -> { request_id, status_url, response_url, cancel_url }
 *   GET   {status_url}                                      -> { status: IN_QUEUE | IN_PROGRESS | COMPLETED, ... }
 *   GET   {response_url}                                    -> the model output (or an HTTP error when it failed)
 *   PUT   {cancel_url}                                      -> 202 CANCELLATION_REQUESTED | 400 ALREADY_COMPLETED
 * Every call carries `Authorization: Key <FAL_KEY>`.
 */

const QUEUE_BASE = 'https://queue.fal.run';
const ENDPOINT_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/i;
const SUBMIT_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 30_000;
const RESULT_MAX_BYTES = 2 * 1024 * 1024;

export function authHeaders(env: Pick<Env, 'FAL_KEY'>): Record<string, string> {
  if (!env.FAL_KEY) throw new ProviderError('auth', 'FAL_KEY is not configured');
  return { authorization: `Key ${env.FAL_KEY}` };
}

/** The key is only ever sent to fal's own queue hosts, whatever the stored or returned URL says. */
export function isFalQueueUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    (url.hostname === 'queue.fal.run' || url.hostname.endsWith('.fal.run'))
  );
}

type QueueUrls = Pick<FalMeta, 'statusUrl' | 'responseUrl' | 'cancelUrl'>;

/**
 * The canonical queue URLs of a request, used only when fal's answer lacks them. fal keeps just
 * the owner and the app name in them: `fal-ai/flux/schnell` is served under `fal-ai/flux/requests`.
 */
function canonicalUrls(endpoint: string, requestId: string): QueueUrls {
  const [owner, app] = endpoint.split('/');
  const base = `${QUEUE_BASE}/${owner}/${app}/requests/${encodeURIComponent(requestId)}`;
  return { statusUrl: `${base}/status`, responseUrl: base, cancelUrl: `${base}/cancel` };
}

export function resolveUrls(
  endpoint: string,
  requestId: string,
  candidate: Partial<Record<keyof QueueUrls, string | null | undefined>>,
): QueueUrls {
  const fallback = canonicalUrls(endpoint, requestId);
  const pick = (value: string | null | undefined, otherwise: string) =>
    value && isFalQueueUrl(value) ? value : otherwise;
  return {
    statusUrl: pick(candidate.statusUrl, fallback.statusUrl),
    responseUrl: pick(candidate.responseUrl, fallback.responseUrl),
    cancelUrl: pick(candidate.cancelUrl, fallback.cancelUrl),
  };
}

export interface SubmittedJob {
  requestId: string;
  urls: QueueUrls;
}

/**
 * fal's queue has no idempotency key. When a submit ends without any HTTP answer (the connection
 * broke, the response was lost, the call timed out) the request may already be queued and billed,
 * and a retry would queue a second paid one whose id we never see and cannot cancel. Such a failure
 * is therefore final. An answer with a status (429, 5xx, ...) means fal replied about this very
 * request, so retrying stays safe and keeps its default.
 */
function finalIfOutcomeUnknown(error: unknown): unknown {
  if (!isProviderError(error) || error.httpStatus !== undefined || !error.retryable) return error;
  return new ProviderError(error.code, error.message, {
    retryable: false,
    userMessage: error.userMessage,
    cause: error.cause,
  });
}

export async function submitJob(
  ctx: ProviderContext,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<SubmittedJob> {
  if (!ENDPOINT_PATTERN.test(endpoint)) {
    throw new ProviderError('unknown', 'Invalid fal endpoint id', { retryable: false });
  }
  const { data } = await httpJson(ctx, {
    url: `${QUEUE_BASE}/${endpoint}`,
    method: 'POST',
    headers: authHeaders(ctx.env),
    body,
    timeoutMs: SUBMIT_TIMEOUT_MS,
    schema: submitResponseSchema,
    classifyError: classifyFalFailure,
  }).catch((error: unknown) => {
    throw finalIfOutcomeUnknown(error);
  });
  const requestId = data.request_id;
  const urls = resolveUrls(endpoint, requestId, {
    statusUrl: data.status_url,
    responseUrl: data.response_url,
    cancelUrl: data.cancel_url,
  });
  return { requestId, urls };
}

export async function fetchStatus(
  ctx: ProviderContext,
  statusUrl: string,
): Promise<FalStatusResponse> {
  const { data } = await httpJson(ctx, {
    url: statusUrl,
    headers: authHeaders(ctx.env),
    timeoutMs: READ_TIMEOUT_MS,
    schema: statusResponseSchema,
    classifyError: classifyFalFailure,
  });
  return data;
}

export type ResultFetch = { ok: true; result: FalResult } | { ok: false; error: ProviderError };

/**
 * Reads the finished request. When fal answers with an error payload the request itself failed
 * (`ok: false`); an answer that is not a fal error (gateway, rate limit, network, auth) throws, so
 * the caller can ask again instead of giving up on a request that may have succeeded.
 */
export async function fetchResult(ctx: ProviderContext, responseUrl: string): Promise<ResultFetch> {
  let reported = false;
  try {
    const { data } = await httpJson(ctx, {
      url: responseUrl,
      headers: authHeaders(ctx.env),
      timeoutMs: READ_TIMEOUT_MS,
      maxResponseBytes: RESULT_MAX_BYTES,
      schema: resultSchema,
      classifyError: (failure) => {
        const interpreted = interpretFailure(failure);
        reported = interpreted?.reported ?? false;
        return interpreted?.error;
      },
    });
    return { ok: true, result: data };
  } catch (error) {
    if (reported && isProviderError(error)) return { ok: false, error };
    throw error;
  }
}

/** Best effort: a request that already finished answers 400 ALREADY_COMPLETED, which is fine. */
export async function cancelJob(ctx: ProviderContext, cancelUrl: string): Promise<void> {
  try {
    await httpJson(ctx, {
      url: cancelUrl,
      method: 'PUT',
      headers: authHeaders(ctx.env),
      timeoutMs: READ_TIMEOUT_MS,
    });
  } catch (error) {
    if (isProviderError(error) && error.httpStatus === 400) return;
    throw error;
  }
}

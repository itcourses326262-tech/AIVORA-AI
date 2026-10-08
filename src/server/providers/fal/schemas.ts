import 'server-only';
import { z } from 'zod';

/*
 * The slices of fal's queue answers this adapter relies on. Shapes follow the official
 * `@fal-ai/client` types (QueueStatus) and the model pages' output examples. Every field is
 * optional or nullable on purpose: fal documents `width`, `height` and `file_size` as nullable and
 * models differ in what else they return, so a missing extra must never fail a paid job.
 */

/** `POST https://queue.fal.run/{endpoint}`. The three URLs are what later calls must use. */
export const submitResponseSchema = z.object({
  request_id: z.string().min(1).max(200),
  status_url: z.string().nullish(),
  response_url: z.string().nullish(),
  cancel_url: z.string().nullish(),
});
export type FalSubmitResponse = z.output<typeof submitResponseSchema>;

/** `GET status_url`: IN_QUEUE, IN_PROGRESS or COMPLETED (plus an error on a failed request). */
export const statusResponseSchema = z.object({
  status: z.string().min(1),
  queue_position: z.number().nullish(),
  error: z.unknown().optional(),
  error_type: z.string().nullish(),
});
export type FalStatusResponse = z.output<typeof statusResponseSchema>;

const dimension = z.number().nullish();

const fileSchema = z.object({
  url: z.string().min(1),
  content_type: z.string().nullish(),
  width: dimension,
  height: dimension,
  duration: z.number().nullish(),
});
export type FalFile = z.output<typeof fileSchema>;

/** `GET response_url`: image models return `images`, video models return `video`. */
export const resultSchema = z.object({
  images: z.array(fileSchema).nullish(),
  video: fileSchema.nullish(),
  seed: z.number().nullish(),
  has_nsfw_concepts: z.array(z.boolean()).nullish(),
  description: z.string().nullish(),
});
export type FalResult = z.output<typeof resultSchema>;

/** What `submit` stores in the generation's `providerMeta`. Never holds a secret or a prompt. */
export const metaSchema = z.object({
  v: z.literal(1),
  requestId: z.string().min(1),
  statusUrl: z.string(),
  responseUrl: z.string(),
  cancelUrl: z.string(),
});
export type FalMeta = z.output<typeof metaSchema>;

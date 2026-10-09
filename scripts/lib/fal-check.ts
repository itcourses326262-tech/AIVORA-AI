// Shared by `npm run setup:fal` and `npm run check:fal`: validating and storing a fal key, and one
// real end-to-end generation through the project's own fal provider (the same code the Studio uses).
// Nothing here prints the key: every line goes through `scrub` first.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { falModels } from '@/lib/catalog/models/fal';
import { createLogger } from '@/server/logger';
import { isProviderError } from '@/server/providers/errors';
import { falProvider } from '@/server/providers/fal';
import type { ProviderContext, ProviderInput } from '@/server/providers/types';

/** The cheapest verified fal model: one image costs about USD 0.003 at fal. */
export const CHECK_MODEL_ID = 'fal-flux-schnell';
export const CHECK_PROMPT = 'a single red apple on a plain white table, studio photo';

export type FalFailure =
  | 'no_key'
  | 'auth'
  | 'rate_limited'
  | 'network'
  | 'timeout'
  | 'invalid_input'
  | 'content_policy'
  | 'unavailable'
  | 'unknown';

export type FalCheckResult =
  | { ok: true; file: string; bytes: number; width?: number; height?: number; ms: number }
  | { ok: false; reason: FalFailure; advice: string };

export function validateFalKey(
  raw: string,
): { ok: true; key: string } | { ok: false; problem: string } {
  const key = raw.trim();
  if (key === '') return { ok: false, problem: 'The key is empty.' };
  if (/\s/.test(key))
    return { ok: false, problem: 'The key contains spaces or line breaks: paste it as one piece.' };
  if (/["'`#]/.test(key))
    return { ok: false, problem: 'The key contains quotes or "#": paste only the key itself.' };
  if (key.length < 20 || key.length > 300) {
    return {
      ok: false,
      problem: 'The key looks too short or too long. Copy it again from the fal dashboard.',
    };
  }
  return { ok: true, key };
}

/**
 * Sets `NAME=value` lines in the text of an env file: replaces an existing line, appends a missing
 * one, keeps every other line and comment, and always ends with a newline. Pure: no file access.
 */
export function upsertEnv(content: string, updates: Record<string, string>): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines =
    content === '' ? [] : content.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const remaining = new Map(Object.entries(updates));
  const next = lines.map((line) => {
    const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (name !== undefined && remaining.has(name)) {
      const value = remaining.get(name) as string;
      remaining.delete(name);
      return `${name}=${value}`;
    }
    return line;
  });
  for (const [name, value] of remaining) next.push(`${name}=${value}`);
  return next.join(eol) + eol;
}

function causeCodes(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') parts.push(code);
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(' ');
}

const NETWORK_HINTS =
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|CONNECT tunnel|certificate|UND_ERR_CONNECT/i;

/** Turns whatever went wrong into one reason and what to do about it (plain English, ASCII). */
export function adviceFor(error: unknown): { reason: FalFailure; advice: string } {
  if (isProviderError(error)) {
    const status = error.httpStatus === undefined ? '' : ` (HTTP ${error.httpStatus})`;
    switch (error.code) {
      case 'auth':
        return {
          reason: 'auth',
          advice:
            `fal rejected the key${status}. Check that: the key was copied completely (it has a colon in the middle), ` +
            'it is an API key and not revoked, and your fal account has balance (an account out of balance is reported the same way).',
        };
      case 'rate_limited':
        return {
          reason: 'rate_limited',
          advice: `fal is rate limiting this key${status}. Wait a minute and run it again.`,
        };
      case 'timeout':
        return {
          reason: 'timeout',
          advice: `fal took too long${status}. Run it again; if it repeats, fal may be having an incident.`,
        };
      case 'content_policy':
        return {
          reason: 'content_policy',
          advice: `fal refused the test prompt${status}. This is unexpected for a plain apple photo; tell the developer.`,
        };
      case 'invalid_input':
        return {
          reason: 'invalid_input',
          advice: `fal rejected the test request${status}: ${error.userMessage}`,
        };
      case 'unavailable':
        if (error.httpStatus === undefined && NETWORK_HINTS.test(causeCodes(error))) {
          return {
            reason: 'network',
            advice:
              'This computer could not reach fal (queue.fal.run). Check your internet connection, a VPN or proxy, ' +
              'and that a firewall or antivirus is not blocking Node.js.',
          };
        }
        return {
          reason: 'unavailable',
          advice: `fal is unavailable right now${status}. Try again in a few minutes.`,
        };
      default:
        return { reason: 'unknown', advice: `fal failed${status}: ${error.message}` };
    }
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError')
      return {
        reason: 'timeout',
        advice: 'The test took longer than 2 minutes and was stopped. Run it again.',
      };
    if (NETWORK_HINTS.test(causeCodes(error))) {
      return {
        reason: 'network',
        advice:
          'This computer could not reach fal. Check your internet connection, a VPN or proxy, and that a firewall or antivirus is not blocking Node.js.',
      };
    }
    return { reason: 'unknown', advice: `${error.name}: ${error.message}` };
  }
  return { reason: 'unknown', advice: String(error) };
}

export interface FalCheckDeps {
  key: string;
  /** Replaceable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  say?: (line: string) => void;
  /** Where the test image is saved. Default `./data`. */
  outDir?: string;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** One real generation with the cheapest model; saves the image and reports what happened. */
export async function runFalCheck(deps: FalCheckDeps): Promise<FalCheckResult> {
  const { key } = deps;
  const scrub = (text: string) => (key === '' ? text : text.split(key).join('[key hidden]'));
  const say = (line: string) => (deps.say ?? console.log)(scrub(line));
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = deps.timeoutMs ?? 120_000;

  if (key === '')
    return { ok: false, reason: 'no_key', advice: 'FAL_KEY is not set. Run: npm run setup:fal' };
  const model = falModels.find((candidate) => candidate.id === CHECK_MODEL_ID);
  if (!model)
    return {
      ok: false,
      reason: 'unknown',
      advice: `Model ${CHECK_MODEL_ID} is missing from the catalog.`,
    };

  const env = { FAL_KEY: key } as ProviderContext['env'];
  const input: ProviderInput = {
    generationId: 'gen_fal_check',
    tool: 'text-to-image',
    model,
    prompt: CHECK_PROMPT,
    params: { aspectRatio: '1:1', count: 1 },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const ctx: ProviderContext = {
    signal: controller.signal,
    env,
    fetch: fetchFn,
    log: createLogger({ level: 'error' }),
  };

  const startedAt = Date.now();
  try {
    say(`1/3 Asking fal (${model.label}) for one test image...`);
    const submitted = await falProvider.submit(input, ctx);
    if (submitted.mode !== 'async') throw new Error('Unexpected answer from the fal provider.');
    say('2/3 Request accepted, waiting for the picture...');

    for (;;) {
      const result = await falProvider.poll(submitted.providerJobId, input, ctx, submitted.meta);
      if (result.status === 'failed') throw result.error;
      if (result.status === 'succeeded') {
        const url = result.outputs[0]?.url;
        if (!url) throw new Error('fal answered without an image.');
        say('3/3 Downloading the picture...');
        const response = await fetchFn(url, { signal: controller.signal });
        if (!response.ok)
          throw new Error(`Downloading the picture failed (HTTP ${response.status}).`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const meta = await sharp(bytes).metadata();
        const outDir = deps.outDir ?? path.resolve(process.cwd(), 'data');
        await mkdir(outDir, { recursive: true });
        const file = path.join(outDir, `fal-test.${meta.format ?? 'png'}`);
        await writeFile(file, bytes);
        return {
          ok: true,
          file,
          bytes: bytes.byteLength,
          ...(meta.width === undefined ? {} : { width: meta.width }),
          ...(meta.height === undefined ? {} : { height: meta.height }),
          ms: Date.now() - startedAt,
        };
      }
      await sleep(1000);
    }
  } catch (error) {
    const { reason, advice } = adviceFor(error);
    return { ok: false, reason, advice: scrub(advice) };
  } finally {
    clearTimeout(timer);
  }
}

// Shared by `npm run check:firebase`: asks Google's sign-in service the two questions the browser
// button asks (is this API key known and allowed here, is the Google method switched on) and turns
// each answer into one plain sentence. The web config is public by design; the key is still never
// printed in full and never put into a URL that is shown.
import { maskedApiKey } from './firebase-config';

export interface FirebaseCheckInput {
  apiKey: string;
  projectId: string;
  /** The address the site is opened at while developing; sent as the page address. */
  origin: string;
}

export interface FirebaseCheckLine {
  ok: boolean;
  title: string;
  /** What to do next; empty when everything is fine. */
  advice: string;
}

export interface FirebaseCheckOptions {
  fetchImpl?: typeof fetch;
  /** Replaces https://identitytoolkit.googleapis.com (tests only). */
  baseUrl?: string;
  timeoutMs?: number;
}

interface GoogleError {
  status: number;
  /** `API_KEY_INVALID`, `OPERATION_NOT_ALLOWED`, ... when Google gave one. */
  reason: string;
  message: string;
}

const BASE = 'https://identitytoolkit.googleapis.com';

/** The code Google puts in an error body: `details[].reason` first, then the message's first word. */
function readGoogleError(status: number, body: unknown): GoogleError {
  const error = (body as { error?: unknown } | null)?.error as
    { message?: unknown; status?: unknown; details?: unknown } | undefined;
  const message = typeof error?.message === 'string' ? error.message : '';
  let reason = '';
  if (Array.isArray(error?.details)) {
    for (const detail of error.details as Array<{ reason?: unknown }>) {
      if (typeof detail?.reason === 'string') {
        reason = detail.reason;
        break;
      }
    }
  }
  if (reason === '') {
    const first = /^[A-Z][A-Z0-9_]+/.exec(message)?.[0];
    reason = first ?? (typeof error?.status === 'string' ? error.status : '');
  }
  return { status, reason, message };
}

/** One sentence per way the key can be refused. */
export function adviceForKeyError(error: GoogleError): string {
  const text = `${error.reason} ${error.message}`.toLowerCase();
  if (error.reason === 'API_KEY_INVALID' || text.includes('api key not valid')) {
    return (
      'Google does not know this API key: it was mistyped, cut short, or deleted. Copy apiKey again ' +
      'from the Firebase console (Project settings > General > Your apps > Web app) and run ' +
      'npm run setup:firebase again.'
    );
  }
  if (error.reason === 'API_KEY_HTTP_REFERRER_BLOCKED' || text.includes('referer')) {
    return (
      'The key is restricted to certain websites and this one is not on the list. In Google Cloud ' +
      'console > APIs & Services > Credentials > the browser key > Website restrictions, add ' +
      'http://localhost:3000/* (and your real domain).'
    );
  }
  if (error.reason === 'API_KEY_SERVICE_BLOCKED' || text.includes('are blocked')) {
    return (
      'The key is not allowed to call the sign-in service. In Google Cloud console > Credentials > ' +
      'the browser key > API restrictions, add "Identity Toolkit API" (or remove the restriction).'
    );
  }
  if (error.reason === 'SERVICE_DISABLED' || text.includes('has not been used')) {
    return 'Authentication is not started. Firebase console > Authentication > Get started.';
  }
  if (error.reason === 'CONFIGURATION_NOT_FOUND') {
    return 'Authentication is not started. Firebase console > Authentication > Get started.';
  }
  return `Google answered ${error.reason || `HTTP ${String(error.status)}`}${
    error.message ? `: ${error.message.slice(0, 160)}` : ''
  }. Send this line to whoever helps you set the site up.`;
}

async function call(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: the status is still informative.
  }
  return { status: response.status, body };
}

/** Runs both questions. Never throws: a network failure is a line like any other. */
export async function runFirebaseCheck(
  input: FirebaseCheckInput,
  options: FirebaseCheckOptions = {},
): Promise<FirebaseCheckLine[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? BASE;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const lines: FirebaseCheckLine[] = [];
  const key = encodeURIComponent(input.apiKey);
  const headers = { Referer: `${input.origin}/`, 'Content-Type': 'application/json' };

  const shape = /^AIza[0-9A-Za-z_-]{35}$/.test(input.apiKey);
  const label = `API key ${maskedApiKey(input.apiKey)}, ends "${input.apiKey.slice(-4)}"`;
  if (!shape) {
    lines.push({
      ok: false,
      title: `${label}: this is not the shape of a Firebase key.`,
      advice:
        'A Firebase web key starts with AIza and has 39 letters, digits, "-" and "_" (no spaces or ' +
        'dots). Copy apiKey again from the Firebase console and run npm run setup:firebase.',
    });
  }

  let project: { status: number; body: unknown };
  try {
    project = await call(
      `${base}/v1/projects?key=${key}`,
      { method: 'GET', headers },
      fetchImpl,
      timeoutMs,
    );
  } catch (error) {
    lines.push({
      ok: false,
      title: 'Could not reach Google.',
      advice: `Check the internet connection (${error instanceof Error ? error.message : String(error)}).`,
    });
    return lines;
  }

  if (project.status !== 200) {
    lines.push({
      ok: false,
      title: `${label}: Google refused it.`,
      advice: adviceForKeyError(readGoogleError(project.status, project.body)),
    });
    return lines;
  }
  if (shape) lines.push({ ok: true, title: `${label}: Google accepts it.`, advice: '' });

  const info = project.body as { projectId?: unknown; authorizedDomains?: unknown } | null;
  const domains = Array.isArray(info?.authorizedDomains)
    ? (info.authorizedDomains as unknown[]).filter((d): d is string => typeof d === 'string')
    : [];
  const host = new URL(input.origin).hostname;
  if (domains.length > 0) {
    const allowed = domains.some((d) => host === d || host.endsWith(`.${d}`));
    lines.push({
      ok: allowed,
      title: allowed
        ? `"${host}" is an authorized domain.`
        : `"${host}" is not in the authorized domains (${domains.join(', ')}).`,
      advice: allowed
        ? ''
        : 'Firebase console > Authentication > Settings > Authorized domains > Add domain.',
    });
  }
  if (
    typeof info?.projectId === 'string' &&
    !/^\d+$/.test(info.projectId) &&
    info.projectId !== input.projectId
  ) {
    lines.push({
      ok: false,
      title: `The key belongs to project "${info.projectId}", the settings say "${input.projectId}".`,
      advice: 'Copy all four values from the same Firebase web app and run setup:firebase again.',
    });
  }

  try {
    const method = await call(
      `${base}/v1/accounts:createAuthUri?key=${key}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ providerId: 'google.com', continueUri: `${input.origin}/` }),
      },
      fetchImpl,
      timeoutMs,
    );
    if (method.status === 200) {
      lines.push({ ok: true, title: 'The Google sign-in method is switched on.', advice: '' });
    } else {
      const error = readGoogleError(method.status, method.body);
      const off = error.reason === 'OPERATION_NOT_ALLOWED';
      lines.push({
        ok: false,
        title: off
          ? 'The Google sign-in method looks switched off.'
          : 'The Google sign-in method could not be checked.',
        advice: off
          ? 'Firebase console > Authentication > Sign-in method > Google > Enable, choose a support email, Save.'
          : adviceForKeyError(error),
      });
    }
  } catch (error) {
    lines.push({
      ok: false,
      title: 'The Google sign-in method could not be checked.',
      advice: error instanceof Error ? error.message : String(error),
    });
  }
  return lines;
}

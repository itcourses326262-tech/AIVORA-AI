import type { EndpointSpec } from './operation';

/** Single quotes inside a single-quoted shell word: close, escape, reopen. */
function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * The cURL command that calls `spec` on a deployment at `origin`, with the example values of the
 * document. What it shows is what works: API-key endpoints send a Bearer header, browser-session
 * ones the cookie jar of a sign-in (`-c cookies.txt` there, `-b cookies.txt` here) and the `Origin`
 * header the CSRF check wants, and the sign-in forms the `Origin` alone.
 */
export function curlFor(spec: EndpointSpec, origin: string): string {
  const base = `${origin}/api/v1`;
  const path = spec.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const example = spec.params?.find(
      (param) => param.in === 'path' && param.name === name,
    )?.example;
    return typeof example === 'string' ? example : `{${name}}`;
  });
  const query = Object.entries(spec.curl?.query ?? {})
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
    .join('&');
  const url = `${base}${path}${query === '' ? '' : `?${query}`}`;

  const mutates = spec.method !== 'get' && spec.method !== 'head';
  const lines: string[] = [];
  const flags: string[] = [];
  if (spec.method === 'head') flags.push('-I');
  else if (spec.method !== 'get') flags.push(`-X ${spec.method.toUpperCase()}`);
  if (spec.curl?.cookies === 'save') flags.push('-c cookies.txt');
  if (spec.curl?.output) flags.push(spec.curl.output);

  const authenticated = spec.curl?.auth ?? (spec.access === 'any' || spec.access === 'session');
  const sendsCookie = spec.access === 'session' || spec.curl?.cookies === 'send';
  if (sendsCookie) flags.push('-b cookies.txt');
  else if (authenticated) {
    lines.push('-H "Authorization: Bearer $AIVORE_API_KEY"');
  }
  if (spec.curl?.origin ?? (sendsCookie && mutates)) {
    lines.push(`-H "Origin: ${origin}"`);
  }
  for (const [name, value] of Object.entries(spec.curl?.headers ?? {})) {
    lines.push(`-H "${name}: ${value}"`);
  }

  const contentType = spec.request?.contentType ?? 'application/json';
  if (spec.request && contentType === 'multipart/form-data') {
    lines.push('-F "file=@photo.png"');
  } else if (spec.request) {
    lines.push('-H "Content-Type: application/json"');
    const body = JSON.stringify(spec.request.example, null, 2).split('\n').join('\n  ');
    lines.push(`-d ${shellQuote(body)}`);
  }

  const head = ['curl', ...flags, `"${url}"`].join(' ');
  return lines.length === 0
    ? head
    : `${head} \\\n${lines.map((line) => `  ${line}`).join(' \\\n')}`;
}

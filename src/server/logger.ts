import 'server-only';

/**
 * Structured logging: one JSON object per line on stdout (debug/info) or stderr (warn/error).
 * Anything under a secret-looking key, and any bearer token or `avk_` API key inside a string, is
 * redacted before it is written, so passing whole request or config objects is safe.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
type EmitLevel = Exclude<LogLevel, 'silent'>;

const SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  /** Pass an `Error` under any key (conventionally `err`); it is serialized with its stack. */
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `bindings` to every line. */
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: LogFields;
  /** Receives each finished line (without trailing newline). Defaults to stdout/stderr. */
  sink?: (level: EmitLevel, line: string) => void;
  now?: () => number;
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

// ---- Redaction -------------------------------------------------------------------------------

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_STRING = 4000;
const MAX_ARRAY = 100;

const SENSITIVE_FRAGMENTS = [
  'password',
  'passwd',
  'passphrase',
  'authorization',
  'apikey',
  'accesskey',
  'privatekey',
  'secret',
  'cookie',
  'credential',
  'signature',
] as const;

function isSensitiveKey(key: string): boolean {
  // `FAL_KEY`-style environment names: a bare `_KEY` suffix is a secret there.
  if (/_KEY$/.test(key)) return true;
  const normalized = key.toLowerCase().replace(/[-_.\s]/g, '');
  return (
    SENSITIVE_FRAGMENTS.some((fragment) => normalized.includes(fragment)) ||
    normalized.endsWith('token') ||
    normalized.endsWith('tokenhash')
  );
}

function scrubString(value: string): string {
  const scrubbed = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bavk_[A-Za-z0-9_-]+/g, `avk_${REDACTED}`);
  return scrubbed.length > MAX_STRING
    ? `${scrubbed.slice(0, MAX_STRING)}...[${scrubbed.length - MAX_STRING} more chars]`
    : scrubbed;
}

function serializeError(
  error: Error,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: scrubString(error.message) };
  if (error.stack) out.stack = scrubString(error.stack);
  for (const key of ['code', 'status', 'details', 'cause'] as const) {
    const value = (error as unknown as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = redactValue(value, seen, depth + 1);
  }
  return out;
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case 'string':
      return scrubString(value);
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return undefined;
  }

  const object = value as object;
  if (seen.has(object)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  if (object instanceof Date) return Number.isNaN(object.getTime()) ? null : object.toISOString();
  if (object instanceof URL) {
    const clean = new URL(object.href);
    clean.username = '';
    clean.password = '';
    return clean.href;
  }
  if (ArrayBuffer.isView(object) || object instanceof ArrayBuffer) {
    return `[binary ${object.byteLength} bytes]`;
  }

  seen.add(object);
  try {
    if (object instanceof Error) return serializeError(object, seen, depth);
    if (Array.isArray(object)) {
      const items = object.slice(0, MAX_ARRAY).map((item) => redactValue(item, seen, depth + 1));
      if (object.length > MAX_ARRAY) items.push(`[${object.length - MAX_ARRAY} more items]`);
      return items;
    }
    if (object instanceof Map || object instanceof Set) return `[${object.constructor.name}]`;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(object)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, seen, depth + 1);
    }
    return out;
  } finally {
    seen.delete(object);
  }
}

/** Returns a JSON-safe copy of `value` with secrets masked. Exported for tests and ad-hoc use. */
export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet(), 0);
}

// ---- Logger ----------------------------------------------------------------------------------

function defaultSink(level: EmitLevel, line: string): void {
  const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? Date.now;
  const bindings = options.bindings ?? {};

  function emit(at: EmitLevel, message: string, fields: LogFields | undefined): void {
    if (SEVERITY[at] < SEVERITY[level]) return;
    const body = redact({ ...bindings, ...fields }) as Record<string, unknown>;
    // Core keys come last so a field can never overwrite them.
    const record = {
      ...body,
      level: at,
      time: new Date(now()).toISOString(),
      msg: scrubString(message),
    };
    sink(at, JSON.stringify(record));
  }

  return {
    level,
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (extra) => createLogger({ ...options, bindings: { ...bindings, ...extra } }),
  };
}

let shared: Logger | undefined;

/** Process-wide logger. The level comes from `LOG_LEVEL` (read directly so env parsing can log too). */
export function getLogger(): Logger {
  if (!shared) {
    const configured = process.env.LOG_LEVEL;
    shared = createLogger({ level: isLogLevel(configured) ? configured : 'info' });
  }
  return shared;
}

export function resetLoggerForTests(): void {
  shared = undefined;
}

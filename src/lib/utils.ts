import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Locale } from '@/lib/i18n/locales';

/** Merges conditional class names and resolves conflicting Tailwind utilities (last one wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError(`clamp: min (${min}) is greater than max (${max})`);
  return Math.min(max, Math.max(min, value));
}

/** Resolves after `ms`; rejects with the signal's reason as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** `JSON.parse` that returns `undefined` instead of throwing. */
export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---- Intl formatting -------------------------------------------------------------------------

// Explicit tags keep output identical across ICU versions: bare `ar` switched its default
// numbering system between CLDR releases, `ar-EG` always uses Arabic-Indic digits and the
// Gregorian calendar (`ar-SA` would default to the Islamic calendar).
const INTL_TAG: Record<Locale, string> = { ar: 'ar-EG', en: 'en-US' };

export function intlTag(locale: Locale): string {
  return INTL_TAG[locale];
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: Locale, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(INTL_TAG[locale], options);
    numberFormats.set(key, format);
  }
  return format;
}

function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_TAG[locale], options);
    dateFormats.set(key, format);
  }
  return format;
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return numberFormat(locale, options).format(value);
}

/** Digits in the locale's numeral system without grouping separators (ids, years, plain counts). */
export function formatPlainNumber(value: number, locale: Locale): string {
  return numberFormat(locale, { useGrouping: false, maximumFractionDigits: 20 }).format(value);
}

export function formatCredits(value: number, locale: Locale): string {
  return formatNumber(value, locale, { maximumFractionDigits: 0 });
}

/**
 * Dates use the runtime's time zone unless `timeZone` (an IANA name) is given. Render them on the
 * client, or pass a fixed zone, when server and browser zones differ to avoid hydration mismatches.
 */
export function formatDate(
  timestampMs: number,
  locale: Locale,
  style: 'short' | 'medium' | 'long' = 'medium',
  timeZone?: string,
): string {
  return dateFormat(locale, { dateStyle: style, timeZone }).format(timestampMs);
}

export function formatDateTime(timestampMs: number, locale: Locale, timeZone?: string): string {
  return dateFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    timestampMs,
  );
}

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 minutes ago" / "منذ ٣ دقائق". Differences under one minute read as "now". */
export function formatRelativeTime(
  timestampMs: number,
  locale: Locale,
  nowMs: number = Date.now(),
): string {
  const formatter = new Intl.RelativeTimeFormat(INTL_TAG[locale], { numeric: 'auto' });
  const diffSec = Math.round((timestampMs - nowMs) / 1000);
  const abs = Math.abs(diffSec);
  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (abs >= seconds) return formatter.format(Math.trunc(diffSec / seconds), unit);
  }
  return formatter.format(0, 'second');
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

export function formatBytes(bytes: number, locale: Locale): string {
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return formatNumber(value, locale, {
    style: 'unit',
    unit: BYTE_UNITS[unitIndex],
    unitDisplay: 'short',
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  });
}

/** Whole seconds as "5 sec" / "٥ ث". */
export function formatSeconds(seconds: number, locale: Locale): string {
  return formatNumber(seconds, locale, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  });
}

// ---- Cursors ---------------------------------------------------------------------------------

/** Packs keyset-pagination values into an opaque URL-safe cursor string. */
export function encodeCursor(parts: ReadonlyArray<string | number>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Inverse of {@link encodeCursor}; null for anything that is not a cursor this module produced. */
export function decodeCursor(cursor: string): Array<string | number> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 512) return null;
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.every((part) => typeof part === 'string' || typeof part === 'number')
      ? (parsed as Array<string | number>)
      : null;
  } catch {
    return null;
  }
}

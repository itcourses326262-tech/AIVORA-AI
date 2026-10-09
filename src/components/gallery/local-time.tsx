'use client';

import { useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { formatDateTime } from '@/lib/utils';

const subscribe = () => () => {};

export interface LocalTimeProps {
  /** Milliseconds since the epoch. */
  timestamp: number;
  className?: string;
}

/**
 * A date and time in the reader's own time zone. The server does not know that zone: it renders
 * UTC, and the browser switches to the local time right after hydration (the snapshot pair of
 * `useSyncExternalStore`), so the two never disagree about the markup.
 */
export function LocalTime({ timestamp, className }: LocalTimeProps) {
  const { locale } = useI18n();
  const text = useSyncExternalStore(
    subscribe,
    () => formatDateTime(timestamp, locale),
    () => formatDateTime(timestamp, locale, 'UTC'),
  );
  return (
    <time dateTime={new Date(timestamp).toISOString()} className={className}>
      {text}
    </time>
  );
}

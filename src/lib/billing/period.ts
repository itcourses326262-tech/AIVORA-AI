/** Time rules of the shop. Isomorphic so the UI can say "renews on …" with the same numbers. */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a checkout (the gateway's hosted payment page) can be paid after it was created. */
export const CHECKOUT_TTL_MS = DAY_MS;

/** The renewal payment link is issued this long before the current period ends. */
export const RENEWAL_LEAD_MS = 3 * DAY_MS;

/**
 * After the period ended the renewal can still be paid for this long. During that time the
 * subscription is `past_due`; afterwards it expires. Credits already granted are never touched.
 */
export const RENEWAL_GRACE_MS = 7 * DAY_MS;

/**
 * Adds `months` calendar months in UTC, keeping the time of day. The day of the month is
 * `anchorDay` (default: the day of `ms`) clamped to the length of the target month, so a
 * subscription started on the 31st renews on Feb 28, then Mar 31 again instead of drifting to the 28th.
 */
export function addMonthsUtc(
  ms: number,
  months: number,
  anchorDay: number = new Date(ms).getUTCDate(),
): number {
  const date = new Date(ms);
  const monthIndex = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), monthIndex + 1, 0)).getUTCDate();
  return Date.UTC(
    date.getUTCFullYear(),
    monthIndex,
    Math.min(Math.max(1, Math.trunc(anchorDay)), lastDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
}

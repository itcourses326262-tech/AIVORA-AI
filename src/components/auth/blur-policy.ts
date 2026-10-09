import type { FocusEvent } from 'react';

/**
 * Whether leaving a field should start showing its validation message.
 *
 * A message that appears while the pointer is going down on a link moves that link away before the
 * button comes up, and the click is lost. That happened on the log in page: the first field has
 * focus on load, so pressing "Forgot password?" or "Create an account" first blurred the empty
 * field, "Enter your email address." pushed everything below it down, and nothing happened until
 * the second press. So:
 *  - a field nobody typed in is not a mistake yet (submitting reports it);
 *  - focus moving to a link means the visitor is leaving the form, not finishing a field.
 * Everything else (tabbing on, clicking another field or a button) is unchanged.
 */
export function shouldValidateOnBlur(
  edited: boolean,
  event: FocusEvent<HTMLElement> | undefined,
): boolean {
  if (!edited) return false;
  const next = event?.relatedTarget;
  return !(next instanceof Element && next.closest('a[href]') !== null);
}

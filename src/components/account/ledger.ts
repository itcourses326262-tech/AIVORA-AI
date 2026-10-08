import type { LedgerReason } from '@/lib/api-types';
import type { MessageKey } from '@/lib/i18n';

/** Where the label of each reason lives; a record, so a new reason cannot be left unlabelled. */
export const REASON_KEYS: Record<LedgerReason, MessageKey> = {
  signup_bonus: 'account.credits.reasons.signup_bonus',
  generation: 'account.credits.reasons.generation',
  refund: 'account.credits.reasons.refund',
  admin_grant: 'account.credits.reasons.admin_grant',
  purchase: 'account.credits.reasons.purchase',
  adjustment: 'account.credits.reasons.adjustment',
};

/** Where a generation of the history can be opened. */
export function generationHref(generationId: string): string {
  return `/gallery/${generationId}`;
}

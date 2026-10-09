import type { LedgerEntryDTO, LedgerReason } from '@/lib/api-types';
import type { MessageKey, Translator } from '@/lib/i18n';

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

/**
 * Whether a person wrote the note of an entry with this reason. The system writes every other note
 * in English with internal ids (`Credit pack pack-500`, `Refund of order ord_...`), which would sit
 * under a localized reason and show an Arabic reader a sentence in another language; their reason
 * already says what happened. A record over the reasons, so a new one has to be decided here.
 */
const NOTE_IS_WRITTEN_BY_A_PERSON: Record<LedgerReason, boolean> = {
  signup_bonus: false,
  generation: false,
  refund: false,
  admin_grant: true,
  purchase: false,
  adjustment: false,
};

/** The note to show under an entry, if it is one a reader should see. */
export function visibleNote(entry: Pick<LedgerEntryDTO, 'reason' | 'note'>): string | undefined {
  return NOTE_IS_WRITTEN_BY_A_PERSON[entry.reason] && entry.note ? entry.note : undefined;
}

/** "20 more entries loaded, 40 in all": what a screen reader hears when a page of the history lands. */
export function loadedMoreLabel(
  { t, plural }: Pick<Translator, 't' | 'plural'>,
  added: number,
  total: number,
): string {
  return plural(
    added,
    {
      one: t('account.credits.moreLoaded.one'),
      two: t('account.credits.moreLoaded.two'),
      few: t('account.credits.moreLoaded.few'),
      many: t('account.credits.moreLoaded.many'),
      other: t('account.credits.moreLoaded.other'),
    },
    { total },
  );
}

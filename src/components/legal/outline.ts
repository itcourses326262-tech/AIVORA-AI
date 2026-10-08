import type { MessageKey } from '@/lib/i18n';
import legal from '@/lib/i18n/messages/legal';
import type { LegalMessageKey } from '@/lib/legal';

/**
 * The sections of a document are the keys of `legal.<document>.sections`, in dictionary order:
 * adding a section is adding its key in both languages, nothing else. (That both languages have the
 * same keys is enforced by `defineMessages` and by `tests/components/legal`.)
 */
export function sectionIdsOf(document: LegalMessageKey): string[] {
  return Object.keys(legal.en[document].sections);
}

/** `yourContent` -> `your-content`: the URL fragment of a section. */
export function anchorOf(sectionId: string): string {
  return sectionId.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The dictionary key of a section's `title` or `body`. */
export function sectionKey(
  document: LegalMessageKey,
  sectionId: string,
  part: 'title' | 'body',
): MessageKey {
  return `legal.${document}.sections.${sectionId}.${part}` as MessageKey;
}

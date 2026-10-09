import type { Locale } from '@/lib/i18n/locales';
import legalDocuments from '@/lib/i18n/messages/legal-documents';
import type { LegalMessageKey } from '@/lib/legal';

export interface LegalSectionText {
  /** The dictionary key, camelCase (`yourContent`); `anchorOf` turns it into the URL fragment. */
  id: string;
  title: string;
  body: string;
}

export interface LegalDocumentText {
  title: string;
  summary: string;
  metaTitle: string;
  metaDescription: string;
  sections: readonly LegalSectionText[];
}

type SectionTexts = Readonly<Record<string, { title: string; body: string }>>;

/**
 * One document in one language, read from `messages/legal-documents.ts`. The sections come in
 * dictionary order, which is their order on the page and in the table of contents: adding a section
 * is adding its key in both languages, nothing else. (That both languages have the same keys is
 * enforced by `defineMessages` and by `tests/components/legal`.) Server only, like the dictionary.
 */
export function documentOf(locale: Locale, document: LegalMessageKey): LegalDocumentText {
  const text = legalDocuments[locale][document];
  const sections: SectionTexts = text.sections;
  return {
    title: text.title,
    summary: text.summary,
    metaTitle: text.meta.title,
    metaDescription: text.meta.description,
    sections: Object.entries(sections).map(([id, section]) => ({
      id,
      title: section.title,
      body: section.body,
    })),
  };
}

/** The section ids of a document, in order. */
export function sectionIdsOf(document: LegalMessageKey): string[] {
  return Object.keys(legalDocuments.en[document].sections);
}

/** `yourContent` -> `your-content`: the URL fragment of a section. */
export function anchorOf(sectionId: string): string {
  return sectionId.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

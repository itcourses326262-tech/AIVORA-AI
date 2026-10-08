import type { Translator } from '@/lib/i18n';
import type { OpenApiDocument } from '@/lib/openapi/types';
import type { CodeWindowLabels } from './code-window';
import type { FieldTableLabels } from './field-table';

/** What every section of the documentation needs: the language, the document and the shared labels. */
export interface DocsContext {
  i18n: Translator;
  document: OpenApiDocument;
  codeLabels: CodeWindowLabels;
  tableLabels: FieldTableLabels;
}

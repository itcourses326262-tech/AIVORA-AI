import { serializeJsonLd } from './seo';

/** Structured data for search engines. The payload is built from our own dictionaries, never from user input. */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

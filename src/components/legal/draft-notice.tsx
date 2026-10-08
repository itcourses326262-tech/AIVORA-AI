import { TriangleAlert } from 'lucide-react';

/**
 * The "Draft — pending legal review" notice. It stays in a printout: a paper copy of an unreviewed
 * template must say what it is.
 */
export function DraftNotice({ title, body }: { title: string; body: string }) {
  return (
    <div
      role="note"
      aria-labelledby="legal-draft-title"
      data-legal-draft=""
      className="flex max-w-3xl gap-3 rounded-2xl border border-warning/40 bg-warning-soft p-4 sm:gap-4 sm:p-5"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="grid gap-1">
        <p id="legal-draft-title" className="font-semibold text-foreground">
          {title}
        </p>
        <p className="text-sm leading-6 text-foreground">{body}</p>
      </div>
    </div>
  );
}

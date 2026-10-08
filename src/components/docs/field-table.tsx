import type { SchemaRow } from '@/lib/openapi/flatten';
import { cn } from '@/lib/utils';
import { Code, Inline } from './prose';

export interface FieldTableLabels {
  field: string;
  type: string;
  description: string;
  required: string;
  /** Names the table for assistive technology. */
  caption: string;
  allowed: string;
}

/** `params.` dimmed, `aspectRatio` strong: the last segment is the field, the rest is where it sits. */
function FieldName({ name }: { name: string }) {
  const cut = Math.max(name.lastIndexOf('.'), name.lastIndexOf(']') + 1);
  const prefix = cut > 0 ? name.slice(0, cut) : '';
  const rest = cut > 0 ? name.slice(cut).replace(/^\./, '') : name;
  return (
    <span lang="en" className="font-mono text-[0.8125rem] [overflow-wrap:anywhere]">
      {prefix ? <span className="text-subtle">{prefix}.</span> : null}
      <span className="font-semibold text-foreground">{rest}</span>
    </span>
  );
}

function TypeLabel({ row }: { row: SchemaRow }) {
  const label = (
    <span lang="en" className="font-mono text-[0.8125rem] text-muted">
      {row.type}
    </span>
  );
  return row.ref ? (
    <a href={`#schema-${row.ref}`} className="text-brand underline-offset-4 hover:underline">
      {label}
    </a>
  ) : (
    label
  );
}

/**
 * The fields of a request or an object as a table: name, type, description. On a narrow screen each
 * row becomes a small card (a table of three columns does not fit a phone). Reference text is
 * English; only the column labels follow the page language.
 */
export function FieldTable({
  rows,
  labels,
}: {
  rows: readonly SchemaRow[];
  labels: FieldTableLabels;
}) {
  return (
    <div dir="ltr" className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-start text-sm max-sm:block">
        <caption className="sr-only">{labels.caption}</caption>
        <thead className="max-sm:hidden">
          <tr className="border-b border-border bg-surface-raised text-xs text-muted">
            <th scope="col" className="w-[28%] px-3.5 py-2 text-start font-medium">
              {labels.field}
            </th>
            <th scope="col" className="w-[18%] px-3.5 py-2 text-start font-medium">
              {labels.type}
            </th>
            <th scope="col" className="px-3.5 py-2 text-start font-medium">
              {labels.description}
            </th>
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {rows.map((row, index) => (
            <tr
              key={`${row.name}-${index}`}
              className={cn(
                'align-top max-sm:grid max-sm:gap-1 max-sm:px-3.5 max-sm:py-3',
                index > 0 && 'border-t border-border',
              )}
            >
              <th scope="row" className="px-3.5 py-2.5 text-start font-normal max-sm:p-0">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <FieldName name={row.name} />
                  {row.required ? (
                    <span className="rounded bg-danger-soft px-1.5 text-[0.6875rem] leading-5 font-medium text-danger">
                      {labels.required}
                    </span>
                  ) : null}
                </span>
              </th>
              <td className="px-3.5 py-2.5 max-sm:p-0">
                <TypeLabel row={row} />
              </td>
              <td className="px-3.5 py-2.5 text-muted max-sm:p-0">
                <div className="grid gap-1.5" lang="en">
                  {row.description ? (
                    <p className="leading-6">
                      <Inline text={row.description} />
                    </p>
                  ) : null}
                  {row.enumValues && row.enumValues.length > 0 ? (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-subtle">{labels.allowed}</span>
                      {row.enumValues.map((value) => (
                        <Code key={value}>{value}</Code>
                      ))}
                    </p>
                  ) : null}
                  {row.constraints.length > 0 ? (
                    <p className="text-xs text-subtle">{row.constraints.join(' · ')}</p>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

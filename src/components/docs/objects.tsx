import { flattenSchema } from '@/lib/openapi/flatten';
import type { DocsContext } from './docs-context';
import { FieldTable } from './field-table';
import { Prose } from './prose';
import { objectSchemaIds, schemaAnchor } from './reference-model';

/** The objects the endpoints return, each described once and linked from every place it is used. */
export function Objects({ ctx }: { ctx: DocsContext }) {
  const { t } = ctx.i18n;
  return (
    <section id="objects" className="grid scroll-mt-32 gap-6 lg:scroll-mt-24">
      <div className="grid gap-3">
        <h2 className="text-2xl font-bold text-foreground">{t('account.docs.objects.title')}</h2>
        <p className="max-w-3xl text-sm leading-7 text-muted">{t('account.docs.objects.intro')}</p>
      </div>
      {objectSchemaIds(ctx.document).map((id) => {
        const schema = ctx.document.components.schemas[id];
        if (!schema || schema.type !== 'object') return null;
        return (
          <div key={id} dir="ltr" className="grid gap-2.5">
            <h3
              id={schemaAnchor(id)}
              className="scroll-mt-32 font-mono text-base font-semibold text-foreground lg:scroll-mt-24"
            >
              <span lang="en">{id}</span>
            </h3>
            {schema.description ? (
              <div lang="en">
                <Prose text={schema.description} />
              </div>
            ) : null}
            <FieldTable rows={flattenSchema(schema, ctx.document)} labels={ctx.tableLabels} />
          </div>
        );
      })}
    </section>
  );
}

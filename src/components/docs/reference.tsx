import type { ReactNode } from 'react';
import { flattenSchema, type SchemaRow } from '@/lib/openapi/flatten';
import type { JsonSchema, OperationObject, ParameterObject } from '@/lib/openapi/types';
import { cn } from '@/lib/utils';
import { CodeWindow } from './code-window';
import type { DocsContext } from './docs-context';
import { FieldTable } from './field-table';
import { MethodBadge } from './method-badge';
import { Code, Inline, Prose } from './prose';
import {
  accessKind,
  budgetText,
  errorRows,
  groupParameters,
  operationAnchor,
  pathSegments,
  referenceGroups,
  returnsOf,
  schemaAnchor,
  statusPhrase,
  successRows,
  tagAnchor,
  type ReferenceOperation,
  type Returns,
} from './reference-model';
import { highlight } from './tokenize';

function Heading({ id, level, children }: { id?: string; level: 3 | 4; children: ReactNode }) {
  const Tag = `h${level}` as const;
  return (
    <Tag
      id={id}
      className={cn(
        'scroll-mt-12 font-semibold text-foreground lg:scroll-mt-0',
        level === 3 ? 'text-xl' : 'text-lg',
      )}
    >
      {children}
    </Tag>
  );
}

function SubHeading({ children, dir }: { children: ReactNode; dir?: 'ltr' | 'rtl' }) {
  return (
    <h5 dir={dir} className={cn('text-sm font-semibold text-foreground', dir && 'w-fit')}>
      {children}
    </h5>
  );
}

function parameterRows(parameters: readonly ParameterObject[]): SchemaRow[] {
  return parameters.map((parameter) => {
    const schema = parameter.schema;
    const type = Array.isArray(schema.type) ? schema.type.join(' | ') : (schema.type ?? 'any');
    const bounds: string[] = [];
    if (schema.minimum !== undefined || schema.maximum !== undefined) {
      bounds.push(`${schema.minimum ?? ''} to ${schema.maximum ?? ''}`);
    }
    if (schema.default !== undefined) bounds.push(`default ${JSON.stringify(schema.default)}`);
    if (parameter.example !== undefined)
      bounds.push(`example ${JSON.stringify(parameter.example)}`);
    return {
      name: parameter.name,
      depth: 0,
      type,
      required: parameter.required === true,
      ...(parameter.description === undefined ? {} : { description: parameter.description }),
      ...(schema.enum ? { enumValues: schema.enum.map((value) => String(value)) } : {}),
      constraints: bounds,
    };
  });
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function JsonExample({
  value,
  title,
  scope,
  ctx,
}: {
  value: unknown;
  title: string;
  scope: string;
  ctx: DocsContext;
}) {
  const text = prettyJson(value);
  return (
    <CodeWindow
      lines={highlight(text, 'json')}
      text={text}
      title={title}
      scope={scope}
      labels={ctx.codeLabels}
    />
  );
}

function ReturnsLine({ returns, ctx }: { returns: Returns; ctx: DocsContext }) {
  const { t, dir } = ctx.i18n;
  const link = (id: string) => (
    <a
      href={`#${schemaAnchor(id)}`}
      dir="ltr"
      lang="en"
      className="font-mono text-brand underline-offset-4 hover:underline"
    >
      {id}
    </a>
  );
  // The sentence is in the reader's language inside a card that reads left to right: it gets its
  // own direction (and shrinks to its text, so it stays at the card's start) or its words and the
  // English name next to them would come out in the wrong order.
  const line = (children: ReactNode) => (
    <p dir={dir} className="w-fit text-sm text-muted">
      {children}
    </p>
  );
  switch (returns.kind) {
    case 'object':
      return line(
        <>
          {t('account.docs.reference.returns')} {link(returns.ref)}
          {returns.nullable ? ` ${t('account.docs.reference.orNull')}` : ''}
        </>,
      );
    case 'array':
      return line(
        <>
          {t('account.docs.reference.returnsArray')} {link(returns.ref)}
        </>,
      );
    case 'page':
      return line(
        <>
          {t('account.docs.reference.returnsPage')} {link(returns.ref)}
        </>,
      );
    case 'file':
      return line(
        <>
          {t('account.docs.reference.returnsFile')}{' '}
          {returns.types.map((type) => (
            <Code key={type}>{type}</Code>
          ))}
        </>,
      );
    default:
      return null;
  }
}

function StatusChip({ status }: { status: number }) {
  const ok = status < 300;
  return (
    <span
      dir="ltr"
      className={cn(
        'inline-flex h-6 items-center rounded-md px-2 font-mono text-xs font-bold',
        ok
          ? 'bg-success-soft text-success'
          : status < 400
            ? 'bg-info-soft text-info'
            : 'bg-danger-soft text-danger',
      )}
    >
      {status}
    </span>
  );
}

function Responses({
  operation,
  scope,
  ctx,
}: {
  operation: OperationObject;
  scope: string;
  ctx: DocsContext;
}) {
  const { t } = ctx.i18n;
  const successes = successRows(operation);
  const errors = errorRows(operation);
  return (
    <div className="grid gap-5">
      <div className="grid gap-4">
        <SubHeading>{t('account.docs.reference.responses')}</SubHeading>
        {successes.map(({ status, response }) => {
          const example = response.content?.['application/json']?.example;
          return (
            <div key={status} className="grid gap-2.5">
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <StatusChip status={status} />
                <span className="font-mono text-xs text-subtle">{statusPhrase(status)}</span>
                <span lang="en">
                  <Inline text={response.description} />
                </span>
              </p>
              <ReturnsLine returns={returnsOf(response)} ctx={ctx} />
              {example === undefined ? null : (
                <JsonExample
                  value={example}
                  title={`${t('account.docs.reference.exampleResponse')} · ${status}`}
                  scope={scope}
                  ctx={ctx}
                />
              )}
            </div>
          );
        })}
      </div>
      {errors.length > 0 ? (
        <div className="grid gap-2.5">
          <SubHeading>{t('account.docs.reference.errors')}</SubHeading>
          <ul className="grid divide-y divide-border overflow-hidden rounded-xl border border-border">
            {errors.map((row) => (
              <li
                key={row.status}
                className="grid gap-1 px-3.5 py-2.5 sm:grid-cols-[auto_minmax(0,11rem)_1fr] sm:items-baseline sm:gap-3"
              >
                <StatusChip status={row.status} />
                <code
                  lang="en"
                  className="font-mono text-[0.8125rem] font-semibold text-foreground"
                >
                  {row.code}
                </code>
                <span lang="en" className="text-sm leading-6 text-muted">
                  <Prose text={row.description} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function RequestBody({
  operation,
  scope,
  ctx,
}: {
  operation: OperationObject;
  scope: string;
  ctx: DocsContext;
}) {
  const body = operation.requestBody;
  if (!body) return null;
  const { t } = ctx.i18n;
  const [contentType, media] = Object.entries(body.content)[0] ?? [];
  if (!contentType || !media?.schema) return null;
  const rows = flattenSchema(media.schema as JsonSchema, ctx.document);
  return (
    <div className="grid gap-2.5">
      <SubHeading dir={ctx.i18n.dir}>
        {t('account.docs.reference.requestBody')}{' '}
        <Code className="ms-1 align-middle">{contentType}</Code>
      </SubHeading>
      {body.description ? (
        <p lang="en" className="text-sm text-muted">
          {body.description}
        </p>
      ) : null}
      <FieldTable rows={rows} labels={ctx.tableLabels} />
      {contentType === 'application/json' && media.example !== undefined ? (
        <JsonExample
          value={media.example}
          title={t('account.docs.reference.exampleBody')}
          scope={scope}
          ctx={ctx}
        />
      ) : null}
    </div>
  );
}

function OperationCard({ entry, ctx }: { entry: ReferenceOperation; ctx: DocsContext }) {
  const { operation, method, path } = entry;
  const { t } = ctx.i18n;
  const access = accessKind(operation);
  const curl = operation['x-codeSamples']?.[0];
  const scope = `${method.toUpperCase()} ${path}`;
  return (
    <article
      dir="ltr"
      id={operationAnchor(entry.id)}
      aria-labelledby={`${operationAnchor(entry.id)}-title`}
      className="scroll-mt-12 rounded-2xl border border-border bg-surface shadow-xs lg:scroll-mt-0"
    >
      <header className="grid gap-3 border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <MethodBadge method={method} />
          <code lang="en" className="font-mono text-sm font-semibold break-all text-foreground">
            {pathSegments(path).map((segment, index) => (
              <span key={index} className={segment.parameter ? 'text-brand' : undefined}>
                {segment.text}
              </span>
            ))}
          </code>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={cn(
              'rounded-full border px-2.5 py-0.5 font-medium',
              access === 'session'
                ? 'border-warning/30 bg-warning-soft text-warning'
                : 'border-border bg-foreground/[0.05] text-muted',
            )}
          >
            <span dir={ctx.i18n.dir}>{t(`account.docs.reference.access.${access}`)}</span>
          </span>
          {(operation['x-rate-limit'] ?? []).map((limit) => (
            <span
              key={limit.bucket}
              lang="en"
              className="rounded-full border border-border bg-foreground/[0.05] px-2.5 py-0.5 text-muted"
            >
              {budgetText(limit)}
            </span>
          ))}
        </div>
        <h4
          id={`${operationAnchor(entry.id)}-title`}
          lang="en"
          className="text-start text-lg font-semibold text-foreground"
        >
          {operation.summary}
        </h4>
        {operation.description ? (
          <div lang="en">
            <Prose text={operation.description} />
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 p-4 sm:p-5">
        {groupParameters(operation).map((group) => (
          <div key={group.location} className="grid gap-2.5">
            <SubHeading>{t(`account.docs.reference.parameters.${group.location}`)}</SubHeading>
            <FieldTable rows={parameterRows(group.parameters)} labels={ctx.tableLabels} />
          </div>
        ))}
        <RequestBody operation={operation} scope={scope} ctx={ctx} />
        {curl ? (
          <div className="grid gap-2.5">
            <SubHeading>{t('account.docs.reference.exampleRequest')}</SubHeading>
            <CodeWindow
              lines={highlight(curl.source, 'bash')}
              text={curl.source}
              title="cURL"
              scope={scope}
              labels={ctx.codeLabels}
            />
          </div>
        ) : null}
        <Responses operation={operation} scope={scope} ctx={ctx} />
      </div>
    </article>
  );
}

/** Every endpoint of the document, grouped under its tag. Text is English technical reference. */
export function Reference({ ctx }: { ctx: DocsContext }) {
  const { t } = ctx.i18n;
  return (
    <section id="reference" className="grid scroll-mt-12 gap-8 lg:scroll-mt-0">
      <div className="grid gap-3">
        <h2 className="text-2xl font-bold text-foreground">{t('account.docs.reference.title')}</h2>
        <p className="max-w-3xl text-sm leading-7 text-muted">
          {t('account.docs.reference.intro')}
        </p>
        <p className="max-w-3xl rounded-xl border border-info/25 bg-info-soft px-4 py-3 text-sm leading-7 text-foreground">
          {t('account.docs.reference.englishNote')}
        </p>
      </div>
      {referenceGroups(ctx.document).map((group) => (
        <div key={group.tag} className="grid gap-5">
          <div className="grid gap-1.5">
            <Heading id={tagAnchor(group.tag)} level={3}>
              <span lang="en">{group.tag}</span>
            </Heading>
            <p lang="en" className="max-w-3xl text-start text-sm text-muted">
              {group.description}
            </p>
          </div>
          {group.operations.map((entry) => (
            <OperationCard key={entry.id} entry={entry} ctx={ctx} />
          ))}
        </div>
      ))}
    </section>
  );
}

import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { GENERATION_STATUSES } from '@/lib/api-types';
import type { JsonSchema } from '@/lib/openapi/types';
import { cn } from '@/lib/utils';
import { CodeWindow } from './code-window';
import type { DocsContext } from './docs-context';
import { LifecycleDiagram } from './lifecycle-diagram';
import { MethodBadge } from './method-badge';
import { Code, Inline, Prose } from './prose';
import {
  accessKind,
  budgetText,
  operationAnchor,
  referenceGroups,
  statusPhrase,
  type ReferenceOperation,
} from './reference-model';
import { highlight } from './tokenize';

export function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-12 gap-5 lg:scroll-mt-0"
    >
      <div className="grid gap-2">
        <h2 id={`${id}-title`} className="text-2xl font-bold text-foreground">
          {title}
        </h2>
        {lead ? <Prose text={lead} className="max-w-3xl" /> : null}
      </div>
      {children}
    </section>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-base font-semibold text-foreground">{children}</h3>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-2 rounded-2xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid gap-1.5 text-sm leading-6 text-muted">{children}</div>
    </div>
  );
}

function allOperations(ctx: DocsContext): ReferenceOperation[] {
  return referenceGroups(ctx.document).flatMap((group) => group.operations);
}

function OperationChip({ entry }: { entry: ReferenceOperation }) {
  return (
    <a
      href={`#${operationAnchor(entry.id)}`}
      dir="ltr"
      lang="en"
      className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1 transition-colors hover:border-border-strong hover:bg-surface-raised"
    >
      <MethodBadge method={entry.method} className="h-5 min-w-12 text-[0.625rem]" />
      <span className="font-mono text-xs text-foreground">{entry.path}</span>
    </a>
  );
}

// ---- Introduction -----------------------------------------------------------------------------

export function Introduction({ ctx, origin }: { ctx: DocsContext; origin: string }) {
  const { t } = ctx.i18n;
  return (
    <Section
      id="introduction"
      title={t('account.docs.intro.title')}
      lead={t('account.docs.intro.lead')}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Card title={t('account.docs.intro.baseUrl')}>
          <Code className="w-fit max-w-full">{`${origin}/api/v1`}</Code>
          <Prose text={t('account.docs.intro.baseUrlNote')} />
        </Card>
        <Card title={t('account.docs.intro.format')}>
          <Prose text={t('account.docs.intro.formatNote')} />
        </Card>
        <Card title={t('account.docs.intro.auth')}>
          <Code className="w-fit max-w-full">Authorization: Bearer avk_…</Code>
          <Prose text={t('account.docs.intro.authNote')} />
        </Card>
      </div>
    </Section>
  );
}

// ---- Authentication ---------------------------------------------------------------------------

export function Authentication({ ctx }: { ctx: DocsContext }) {
  const { t } = ctx.i18n;
  const operations = allOperations(ctx);
  const byKey = operations.filter((entry) => accessKind(entry.operation) !== 'session');
  const bySession = operations.filter((entry) => accessKind(entry.operation) === 'session');
  const tips = [
    t('account.docs.auth.tip1'),
    t('account.docs.auth.tip2'),
    t('account.docs.auth.tip3'),
    t('account.docs.auth.tip4'),
  ];
  return (
    <Section
      id="authentication"
      title={t('account.docs.auth.title')}
      lead={t('account.docs.auth.lead')}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="grid content-start gap-3 rounded-2xl border border-border bg-surface p-4">
          <SubTitle>{t('account.docs.auth.withKey')}</SubTitle>
          <p className="text-sm leading-6 text-muted">{t('account.docs.auth.withKeyNote')}</p>
          <div className="flex flex-wrap gap-1.5">
            {byKey.map((entry) => (
              <OperationChip key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
        <div className="grid content-start gap-3 rounded-2xl border border-border bg-surface p-4">
          <SubTitle>{t('account.docs.auth.sessionOnly')}</SubTitle>
          <p className="text-sm leading-6 text-muted">
            <Inline text={t('account.docs.auth.sessionOnlyNote')} />
          </p>
          <div className="flex flex-wrap gap-1.5">
            {bySession.map((entry) => (
              <OperationChip key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-3 rounded-2xl border border-border bg-surface p-4">
        <SubTitle>
          <span className="inline-flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-4 text-success" />
            {t('account.docs.auth.tipsTitle')}
          </span>
        </SubTitle>
        <ul className="grid list-disc gap-1.5 ps-5 text-sm leading-6 text-muted marker:text-subtle">
          {tips.map((tip) => (
            <li key={tip}>
              <Inline text={tip} />
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

// ---- Conventions ------------------------------------------------------------------------------

function exampleOf(
  ctx: DocsContext,
  path: string,
  method: 'get' | 'post',
  status: string,
): unknown {
  const response = ctx.document.paths[path]?.[method]?.responses[status];
  if (!response || '$ref' in response) return undefined;
  return response.content?.['application/json']?.example;
}

function Json({ value, title, ctx }: { value: unknown; title: string; ctx: DocsContext }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <CodeWindow lines={highlight(text, 'json')} text={text} title={title} labels={ctx.codeLabels} />
  );
}

export function Conventions({ ctx }: { ctx: DocsContext }) {
  const { t } = ctx.i18n;
  const list = exampleOf(ctx, '/account/ledger', 'get', '200') as { data: unknown[] } | undefined;
  const one = exampleOf(ctx, '/account', 'get', '200');
  const failed = exampleOf(ctx, '/generations/{id}', 'get', '404');
  return (
    <Section
      id="conventions"
      title={t('account.docs.conventions.title')}
      lead={t('account.docs.conventions.lead')}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Json value={one} title={t('account.docs.conventions.single')} ctx={ctx} />
        <Json
          value={list ? { data: list.data.slice(0, 1), nextCursor: 'eyJ…' } : undefined}
          title={t('account.docs.conventions.list')}
          ctx={ctx}
        />
        <Json value={failed} title={t('account.docs.conventions.failure')} ctx={ctx} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title={t('account.docs.conventions.paginationTitle')}>
          <Prose text={t('account.docs.conventions.pagination')} />
        </Card>
        <Card title={t('account.docs.conventions.valuesTitle')}>
          <Prose text={t('account.docs.conventions.values')} />
        </Card>
      </div>
    </Section>
  );
}

// ---- Errors -----------------------------------------------------------------------------------

export function Errors({ ctx }: { ctx: DocsContext }) {
  const { t } = ctx.i18n;
  const codes = ctx.document.components.schemas.ErrorCode as JsonSchema | undefined;
  const descriptions = (codes?.['x-enum-descriptions'] ?? {}) as Record<string, string>;
  const statuses = (codes?.['x-enum-statuses'] ?? {}) as Record<string, number>;
  const issues = exampleOf(ctx, '/generations', 'post', '422');
  return (
    <Section
      id="errors"
      title={t('account.docs.errors.title')}
      lead={t('account.docs.errors.lead')}
    >
      <Json value={issues} title={t('account.docs.errors.validationExample')} ctx={ctx} />
      <div dir="ltr" className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-start text-sm max-sm:block">
          <caption className="sr-only">{t('account.docs.errors.caption')}</caption>
          <thead className="max-sm:hidden">
            <tr className="border-b border-border bg-surface-raised text-xs text-muted">
              <th scope="col" className="w-36 px-3.5 py-2 text-start font-medium">
                {t('account.docs.errors.status')}
              </th>
              <th scope="col" className="w-[30%] px-3.5 py-2 text-start font-medium">
                {t('account.docs.errors.code')}
              </th>
              <th scope="col" className="px-3.5 py-2 text-start font-medium">
                {t('account.docs.errors.meaning')}
              </th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {Object.entries(descriptions).map(([code, meaning], index) => {
              const status = statuses[code] ?? 0;
              return (
                <tr
                  key={code}
                  className={cn(
                    'align-top max-sm:grid max-sm:gap-1 max-sm:px-3.5 max-sm:py-3',
                    index > 0 && 'border-t border-border',
                  )}
                >
                  <td className="px-3.5 py-2.5 max-sm:p-0">
                    <span dir="ltr" className="font-mono text-[0.8125rem] font-semibold">
                      {status}{' '}
                      <span className="font-normal text-subtle">{statusPhrase(status)}</span>
                    </span>
                  </td>
                  <th scope="row" className="px-3.5 py-2.5 text-start font-normal max-sm:p-0">
                    <code dir="ltr" lang="en" className="font-mono text-[0.8125rem] font-semibold">
                      {code}
                    </code>
                  </th>
                  <td className="px-3.5 py-2.5 text-muted max-sm:p-0">
                    <div lang="en" dir="ltr">
                      <Prose text={meaning} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---- Idempotency ------------------------------------------------------------------------------

export function Idempotency({ ctx }: { ctx: DocsContext }) {
  const { t } = ctx.i18n;
  const sample = [
    'curl -X POST "$BASE_URL/generations" \\',
    '  -H "Idempotency-Key: 0b7f3c52-8f3e-4a52-9a5e-3c1d6f5c9e10" \\',
    '  …',
  ].join('\n');
  return (
    <Section
      id="idempotency"
      title={t('account.docs.idempotency.title')}
      lead={t('account.docs.idempotency.lead')}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Prose text={t('account.docs.idempotency.rules')} />
        <CodeWindow
          lines={highlight(sample, 'bash')}
          text={sample}
          title="cURL"
          scope={t('account.docs.idempotency.title')}
          labels={ctx.codeLabels}
        />
      </div>
    </Section>
  );
}

// ---- Rate limits ------------------------------------------------------------------------------

interface BudgetRow {
  bucket: string;
  text: string;
  operations: ReferenceOperation[];
}

function budgets(ctx: DocsContext): BudgetRow[] {
  const rows = new Map<string, BudgetRow>();
  for (const entry of allOperations(ctx)) {
    for (const limit of entry.operation['x-rate-limit'] ?? []) {
      const row = rows.get(limit.bucket) ?? {
        bucket: limit.bucket,
        text: budgetText(limit),
        operations: [],
      };
      row.operations.push(entry);
      rows.set(limit.bucket, row);
    }
  }
  return [...rows.values()];
}

export function RateLimits({ ctx }: { ctx: DocsContext }) {
  const { t } = ctx.i18n;
  const retry = exampleOf(ctx, '/generations', 'get', '429');
  return (
    <Section
      id="rate-limits"
      title={t('account.docs.limits.title')}
      lead={t('account.docs.limits.lead')}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Prose text={t('account.docs.limits.headers')} />
        <Json value={retry} title={t('account.docs.limits.example')} ctx={ctx} />
      </div>
      <div dir="ltr" className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-start text-sm max-sm:block">
          <caption className="sr-only">{t('account.docs.limits.caption')}</caption>
          <thead className="max-sm:hidden">
            <tr className="border-b border-border bg-surface-raised text-xs text-muted">
              <th scope="col" className="w-[38%] px-3.5 py-2 text-start font-medium">
                {t('account.docs.limits.budget')}
              </th>
              <th scope="col" className="px-3.5 py-2 text-start font-medium">
                {t('account.docs.limits.endpoints')}
              </th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {budgets(ctx).map((row, index) => (
              <tr
                key={row.bucket}
                className={cn(
                  'align-top max-sm:grid max-sm:gap-1.5 max-sm:px-3.5 max-sm:py-3',
                  index > 0 && 'border-t border-border',
                )}
              >
                <th scope="row" className="px-3.5 py-2.5 text-start font-normal max-sm:p-0">
                  <span lang="en" dir="ltr" className="text-foreground">
                    {row.text}
                  </span>
                </th>
                <td className="px-3.5 py-2.5 max-sm:p-0">
                  <div className="flex flex-wrap gap-1.5">
                    {row.operations.map((entry) => (
                      <OperationChip key={entry.id} entry={entry} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---- Credits ----------------------------------------------------------------------------------

export function Credits({
  ctx,
  example,
}: {
  ctx: DocsContext;
  example: { modelId: string; cost: number };
}) {
  const { t } = ctx.i18n;
  const cost = creditsLabel(ctx.i18n, example.cost);
  return (
    <Section
      id="credits"
      title={t('account.docs.credits.title')}
      lead={t('account.docs.credits.lead')}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title={t('account.docs.credits.priceTitle')}>
          <Prose text={t('account.docs.credits.price')} />
          <p className="rounded-lg bg-foreground/[0.05] px-3 py-2 text-foreground">
            <Inline text={t('account.docs.credits.example', { model: example.modelId, cost })} />
          </p>
        </Card>
        <Card title={t('account.docs.credits.chargeTitle')}>
          <Prose text={t('account.docs.credits.charge')} />
        </Card>
      </div>
    </Section>
  );
}

// ---- Lifecycle --------------------------------------------------------------------------------

export function Lifecycle({ ctx }: { ctx: DocsContext }) {
  const { t } = ctx.i18n;
  return (
    <Section
      id="lifecycle"
      title={t('account.docs.lifecycle.title')}
      lead={t('account.docs.lifecycle.lead')}
    >
      <LifecycleDiagram
        title={t('account.docs.lifecycle.diagramTitle')}
        description={t('account.docs.lifecycle.diagramDescription')}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-start text-sm max-sm:block">
          <caption className="sr-only">{t('account.docs.lifecycle.caption')}</caption>
          <thead className="max-sm:hidden">
            <tr className="border-b border-border bg-surface-raised text-xs text-muted">
              <th scope="col" className="w-[24%] px-3.5 py-2 text-start font-medium">
                {t('account.docs.lifecycle.status')}
              </th>
              <th scope="col" className="w-[16%] px-3.5 py-2 text-start font-medium">
                {t('account.docs.lifecycle.kind')}
              </th>
              <th scope="col" className="px-3.5 py-2 text-start font-medium">
                {t('account.docs.lifecycle.meaning')}
              </th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {GENERATION_STATUSES.map((status, index) => (
              <tr
                key={status}
                className={cn(
                  'align-top max-sm:grid max-sm:gap-1 max-sm:px-3.5 max-sm:py-3',
                  index > 0 && 'border-t border-border',
                )}
              >
                <th scope="row" className="px-3.5 py-2.5 text-start font-normal max-sm:p-0">
                  <code dir="ltr" className="font-mono text-[0.8125rem] font-semibold">
                    {status}
                  </code>
                </th>
                <td className="px-3.5 py-2.5 text-muted max-sm:p-0">
                  {t(
                    status === 'queued' || status === 'processing'
                      ? 'account.docs.lifecycle.inProgress'
                      : 'account.docs.lifecycle.final',
                  )}
                </td>
                <td className="px-3.5 py-2.5 text-muted max-sm:p-0">
                  <Inline text={t(`account.docs.lifecycle.statuses.${status}`)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('account.docs.lifecycle.pollingTitle')}>
          <Prose text={t('account.docs.lifecycle.polling')} />
        </Card>
        <Card title={t('account.docs.lifecycle.noWebhooksTitle')}>
          <Prose text={t('account.docs.lifecycle.noWebhooks')} />
        </Card>
      </div>
    </Section>
  );
}

// ---- OpenAPI ----------------------------------------------------------------------------------

export function OpenApiSection({ ctx, origin }: { ctx: DocsContext; origin: string }) {
  const { t } = ctx.i18n;
  const command = `curl -O ${origin}/api/v1/openapi.json`;
  return (
    <Section
      id="openapi"
      title={t('account.docs.openapi.title')}
      lead={t('account.docs.openapi.lead')}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <CodeWindow
          lines={highlight(command, 'bash')}
          text={command}
          title="cURL"
          scope={t('account.docs.openapi.title')}
          labels={ctx.codeLabels}
        />
        <a
          href="/api/v1/openapi.json"
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium transition-colors hover:border-border-strong hover:bg-surface-raised"
        >
          <span>{t('account.docs.openapi.open')}</span>
          <span dir="ltr" className="font-mono text-xs text-brand">
            /api/v1/openapi.json
          </span>
        </a>
      </div>
    </Section>
  );
}

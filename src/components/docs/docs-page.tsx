import { ArrowRight, Download, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Directional } from '@/components/ui/icon';
import type { Translator } from '@/lib/i18n';
import type { OpenApiDocument } from '@/lib/openapi/types';
import {
  Authentication,
  Conventions,
  Credits,
  Errors,
  Idempotency,
  Introduction,
  Lifecycle,
  OpenApiSection,
  RateLimits,
} from './concepts';
import { DocsNav, type DocsNavNode } from './docs-nav';
import type { DocsContext } from './docs-context';
import { Objects } from './objects';
import { Quickstart } from './quickstart';
import type { QuickstartModel } from './quickstart-model';
import { Reference } from './reference';
import {
  objectSchemaIds,
  operationAnchor,
  referenceGroups,
  schemaAnchor,
  tagAnchor,
} from './reference-model';

export const QUICKSTART_PROMPT = 'A lighthouse at dawn, soft fog, cinematic';

/** The table of contents: sections in page order, the reference expanded down to each endpoint. */
export function buildDocsNav(
  document: OpenApiDocument,
  { t }: Pick<Translator, 't'>,
): DocsNavNode[] {
  const section = (id: string, label: string): DocsNavNode => ({ id, label });
  return [
    section('introduction', t('account.docs.nav.introduction')),
    section('quickstart', t('account.docs.nav.quickstart')),
    section('authentication', t('account.docs.nav.authentication')),
    section('lifecycle', t('account.docs.nav.lifecycle')),
    section('conventions', t('account.docs.nav.conventions')),
    section('errors', t('account.docs.nav.errors')),
    section('idempotency', t('account.docs.nav.idempotency')),
    section('rate-limits', t('account.docs.nav.rateLimits')),
    section('credits', t('account.docs.nav.credits')),
    {
      id: 'reference',
      label: t('account.docs.nav.reference'),
      children: referenceGroups(document).map((group) => ({
        id: tagAnchor(group.tag),
        label: group.tag,
        children: group.operations.map((entry) => ({
          id: operationAnchor(entry.id),
          label: entry.operation.summary,
          badge: entry.method.toUpperCase(),
        })),
      })),
    },
    {
      id: 'objects',
      label: t('account.docs.nav.objects'),
      children: objectSchemaIds(document)
        .filter((id) => document.components.schemas[id]?.type === 'object')
        .map((id) => ({ id: schemaAnchor(id), label: id })),
    },
    section('openapi', t('account.docs.nav.openapi')),
  ];
}

export interface DocsPageProps {
  i18n: Translator;
  document: OpenApiDocument;
  /** `https://host` of this deployment. */
  origin: string;
  quickstart: QuickstartModel | undefined;
}

/** Fallback when the catalog offers no image model at all (a deployment with nothing configured). */
const FALLBACK_MODEL: QuickstartModel = {
  modelId: 'aivore-demo-image',
  aspectRatio: '16:9',
  cost: 1,
  usable: false,
};

/**
 * The public API documentation: introduction and quickstart in the reader's language, the
 * conventions every endpoint shares, and the endpoint reference generated from the OpenAPI
 * document. Renders the page's one `<main>`.
 */
export function DocsPage({ i18n, document, origin, quickstart }: DocsPageProps) {
  const { t } = i18n;
  const ctx: DocsContext = {
    i18n,
    document,
    codeLabels: {
      copy: t('account.docs.copy.copy'),
      copied: t('account.docs.copy.copied'),
      copyFailed: t('account.docs.copy.failed'),
    },
    tableLabels: {
      field: t('account.docs.table.field'),
      type: t('account.docs.table.type'),
      description: t('account.docs.table.description'),
      required: t('account.docs.table.required'),
      caption: t('account.docs.table.caption'),
      allowed: t('account.docs.table.allowed'),
    },
  };
  const model = quickstart ?? FALLBACK_MODEL;

  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 sm:px-6">
      <header className="grid gap-5 py-10 sm:py-14">
        <p className="w-fit rounded-full border border-brand/25 bg-brand-soft px-3 py-1 text-xs font-semibold text-brand">
          {t('account.docs.hero.eyebrow')}
        </p>
        <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t('account.docs.hero.title')}
        </h1>
        <p className="max-w-2xl text-base leading-8 text-muted">
          {t('account.docs.hero.subtitle')}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            href="/account?tab=keys"
            size="lg"
            startIcon={<KeyRound aria-hidden="true" className="size-5" />}
          >
            {t('account.docs.hero.createKey')}
          </Button>
          <Button
            href="#quickstart"
            variant="secondary"
            size="lg"
            endIcon={
              <Directional>
                <ArrowRight aria-hidden="true" className="size-5" />
              </Directional>
            }
          >
            {t('account.docs.hero.quickstart')}
          </Button>
          <Button
            href="/api/v1/openapi.json"
            variant="ghost"
            size="lg"
            startIcon={<Download aria-hidden="true" className="size-5" />}
          >
            {t('account.docs.hero.openapi')}
          </Button>
        </div>
      </header>

      <div className="grid gap-x-12 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        <DocsNav nodes={buildDocsNav(document, i18n)} title={t('account.docs.nav.title')} />
        <div className="grid min-w-0 gap-16 pt-8 lg:pt-0">
          <Introduction ctx={ctx} origin={origin} />
          <Quickstart
            ctx={ctx}
            input={{
              origin,
              modelId: model.modelId,
              prompt: QUICKSTART_PROMPT,
              aspectRatio: model.aspectRatio,
            }}
            cost={model.cost}
          />
          <Authentication ctx={ctx} />
          <Lifecycle ctx={ctx} />
          <Conventions ctx={ctx} />
          <Errors ctx={ctx} />
          <Idempotency ctx={ctx} />
          <RateLimits ctx={ctx} />
          <Credits ctx={ctx} example={{ modelId: model.modelId, cost: model.cost }} />
          <Reference ctx={ctx} />
          <Objects ctx={ctx} />
          <OpenApiSection ctx={ctx} origin={origin} />
        </div>
      </div>
    </main>
  );
}

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import {
  COMPANY_FIELDS,
  EMAIL_FIELDS,
  LEGAL_LINK_TARGETS,
  type CompanyField,
  type CompanyInfo,
} from '@/lib/legal';
import type { TFunction } from '@/lib/i18n';
import { CONFIRM_TOKEN, parseMarkup, type Block, type Inline } from './markup';

const linkClass =
  'rounded-sm font-medium text-brand underline decoration-brand/40 underline-offset-4 transition-colors hover:decoration-brand';

export interface LegalTextContext {
  t: TFunction;
  company: CompanyInfo;
  /** Shows the "to confirm" flags (`LEGAL_DRAFT`). */
  draft: boolean;
}

function isCompanyField(name: string): name is CompanyField {
  return (COMPANY_FIELDS as readonly string[]).includes(name);
}

/** A company detail, or a highlighted placeholder that says what is missing: details are never invented. */
function CompanyValue({ field, ctx }: { field: CompanyField; ctx: LegalTextContext }) {
  const value = ctx.company[field];
  if (value === null) {
    return (
      <mark
        data-placeholder={field}
        className="rounded-sm bg-warning-soft box-decoration-clone px-1 py-0.5 font-medium text-foreground ring-1 ring-warning/40 ring-inset"
      >
        {ctx.t('legal.common.placeholder.missing', {
          label: ctx.t(`legal.common.placeholder.${field}`),
        })}
      </mark>
    );
  }
  if (EMAIL_FIELDS.has(field)) {
    return (
      <a href={`mailto:${value}`} dir="ltr" className={linkClass}>
        {value}
      </a>
    );
  }
  return <bdi>{value}</bdi>;
}

/** The small "to confirm" chip that marks wording counsel has to decide. */
function ConfirmFlag({ ctx }: { ctx: LegalTextContext }) {
  return (
    <span
      data-confirm=""
      title={ctx.t('legal.common.confirm.long')}
      className="mx-0.5 inline-block rounded-full border border-warning/40 bg-warning-soft px-2 align-baseline text-[0.7rem] leading-5 font-medium whitespace-nowrap text-warning"
    >
      {ctx.t('legal.common.confirm.short')}
    </span>
  );
}

function InlineNode({ node, ctx }: { node: Inline; ctx: LegalTextContext }): ReactNode {
  switch (node.type) {
    case 'text':
      return node.text;
    case 'strong':
      return <strong className="font-semibold text-foreground">{node.text}</strong>;
    case 'code':
      return (
        <code
          dir="ltr"
          className="rounded-sm bg-foreground/[0.07] px-1.5 py-0.5 font-mono text-[0.85em] leading-none text-foreground"
        >
          {node.text}
        </code>
      );
    case 'link':
      return (
        <Link href={node.href} className={linkClass}>
          {node.label}
        </Link>
      );
    case 'token':
      if (node.name === CONFIRM_TOKEN) return <ConfirmFlag ctx={ctx} />;
      if (isCompanyField(node.name)) return <CompanyValue field={node.name} ctx={ctx} />;
      // An unknown token is a mistake in a dictionary: leave it visible so it gets noticed.
      return `{${node.name}}`;
  }
}

function Inlines({ nodes, ctx }: { nodes: Inline[]; ctx: LegalTextContext }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={index}>
          <InlineNode node={node} ctx={ctx} />
        </Fragment>
      ))}
    </>
  );
}

function BlockNode({ block, ctx }: { block: Block; ctx: LegalTextContext }) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p>
          <Inlines nodes={block.inline} ctx={ctx} />
        </p>
      );
    case 'subheading':
      return (
        <h3 className="mt-4 -mb-1 text-lg font-semibold text-foreground first:mt-0 rtl:font-bold">
          {block.text}
        </h3>
      );
    case 'list':
      return (
        <ul className="grid list-disc gap-2.5 ps-6 marker:text-subtle">
          {block.items.map((item, index) => (
            <li key={index} className="ps-1">
              <Inlines nodes={item} ctx={ctx} />
            </li>
          ))}
        </ul>
      );
  }
}

/**
 * Renders one section body of a legal dictionary: paragraphs, lists and sub-headings, with the
 * company details and the "to confirm" flags filled in. Pure (no hooks), so it renders in server
 * components and in tests alike.
 */
export function LegalText({ body, ctx }: { body: string; ctx: LegalTextContext }) {
  const blocks = parseMarkup(body, { draft: ctx.draft, linkTargets: LEGAL_LINK_TARGETS });
  return (
    <>
      {blocks.map((block, index) => (
        <BlockNode key={index} block={block} ctx={ctx} />
      ))}
    </>
  );
}

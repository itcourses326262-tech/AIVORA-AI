import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

/** Inline code: always left to right, isolated from the surrounding (Arabic) text. */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      dir="ltr"
      lang="en"
      className={cn(
        'rounded-md bg-foreground/[0.08] px-1.5 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere] text-foreground',
        className,
      )}
    >
      {children}
    </code>
  );
}

function link(label: string, href: string, key: number): ReactNode {
  const internal = href.startsWith('/') || href.startsWith('#');
  return (
    <a
      key={key}
      href={href}
      {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
      className="text-brand underline underline-offset-4 hover:no-underline"
    >
      {label}
    </a>
  );
}

/** `code`, **bold** and [links](/x) inside a line of text. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return <Code key={index}>{part.slice(1, -1)}</Code>;
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <strong key={index} className="font-semibold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }
        const anchor = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
        if (anchor) return link(anchor[1] ?? '', anchor[2] ?? '', index);
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

/**
 * Paragraphs and bullet lists (`- item`) of the small markdown subset the document and the
 * dictionaries use. It builds elements, never HTML strings, so nothing in `text` can inject markup.
 */
export function Prose({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim());
  return (
    <div className={cn('grid gap-3 text-sm leading-7 text-muted', className)}>
      {blocks.map((block, index) => {
        const lines = block.split('\n');
        if (lines.every((line) => line.startsWith('- '))) {
          return (
            <ul key={index} className="grid list-disc gap-1.5 ps-5 marker:text-subtle">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  <Inline text={line.slice(2)} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            <Inline text={block} />
          </p>
        );
      })}
    </div>
  );
}

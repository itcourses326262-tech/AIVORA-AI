import type { ReactNode } from 'react';
import { CopyButton } from '@/components/marketing/copy-button';
import { cn } from '@/lib/utils';
import type { CodeLine, TokenKind } from './tokenize';

/*
 * Code keeps one dark palette in both themes, like a terminal, so a snippet looks the same
 * wherever it is pasted from. Every colour is at least 4.5:1 on the #0d0d1c background.
 */
const TOKEN_COLOR: Record<TokenKind, string> = {
  plain: 'text-[#dcdcf0]',
  keyword: 'font-medium text-[#f0abfc]',
  string: 'text-[#86efac]',
  number: 'text-[#fcd34d]',
  comment: 'italic text-[#9a9abb]',
  property: 'text-[#a5b4fc]',
  function: 'text-[#7dd3fc]',
  punctuation: 'text-[#9a9abb]',
  flag: 'text-[#67e8f9]',
  variable: 'text-[#fdba74]',
  command: 'font-semibold text-[#c4b5fd]',
};

export interface CodeWindowLabels {
  copy: string;
  copied: string;
  copyFailed: string;
}

export interface CodeWindowProps {
  lines: readonly CodeLine[];
  /** The plain text the copy button puts in the clipboard. */
  text: string;
  /** Names the window: `cURL`, `JavaScript`, `Example response`. */
  title: string;
  /**
   * What the example belongs to: the step, the endpoint, the section. A page holds many windows
   * called `cURL`, and a landmark name has to tell them apart for someone who cannot see where
   * they sit.
   */
  scope?: string;
  labels: CodeWindowLabels;
  /** Extra controls in the title bar, before the copy button. */
  actions?: ReactNode;
  className?: string;
}

/**
 * A highlighted snippet in a window with a title bar and a copy button. Code is always left to
 * right, also in the Arabic layout, and can be scrolled sideways by keyboard.
 */
export function CodeWindow({
  lines,
  text,
  title,
  scope,
  labels,
  actions,
  className,
}: CodeWindowProps) {
  return (
    <div
      dir="ltr"
      className={cn(
        'overflow-hidden rounded-xl border border-white/10 bg-[#0d0d1c] text-left shadow-md',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.04] py-1.5 ps-4 pe-2">
        <span className="truncate text-xs font-medium text-[#b4b4d0]">{title}</span>
        <div className="flex items-center gap-2">
          {actions}
          <CopyButton
            text={text}
            label={labels.copy}
            copiedLabel={labels.copied}
            failedLabel={labels.copyFailed}
          />
        </div>
      </div>
      <pre
        role="region"
        aria-label={scope ? `${scope} · ${title}` : title}
        tabIndex={0}
        lang="en"
        className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-6 whitespace-pre text-[#dcdcf0] -outline-offset-2 focus-visible:outline-[#a5b4fc]"
      >
        <code>
          {lines.map((line, index) => (
            <span key={index} className="block min-h-6">
              {line.map((token, tokenIndex) =>
                token.kind === 'plain' ? (
                  token.text
                ) : (
                  <span key={tokenIndex} className={TOKEN_COLOR[token.kind]}>
                    {token.text}
                  </span>
                ),
              )}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

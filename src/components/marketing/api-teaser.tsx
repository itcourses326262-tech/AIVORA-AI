import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Directional } from '@/components/ui/icon';
import type { MessageKey, Translator } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  requestLines,
  responseLines,
  snippetText,
  type CodeLine,
  type SnippetOptions,
  type TokenKind,
} from './api-snippet';
import { CopyButton } from './copy-button';
import { Section, SectionHeader } from './section';
import styles from './marketing.module.css';

/*
 * The code window keeps one dark palette in both themes, like a terminal: every colour below is
 * at least 4.5:1 on its #0d0d1c background.
 */
const TOKEN_COLOR: Record<TokenKind, string> = {
  plain: 'text-[#dcdcf0]',
  command: 'font-semibold text-[#c4b5fd]',
  flag: 'text-[#67e8f9]',
  string: 'text-[#86efac]',
  key: 'text-[#a5b4fc]',
  number: 'text-[#fcd34d]',
  punctuation: 'text-[#9a9abb]',
};

const POINTS: readonly MessageKey[] = [
  'landing.api.points.json',
  'landing.api.points.keys',
  'landing.api.points.async',
  'landing.api.points.docs',
];

function Code({ lines, label }: { lines: readonly CodeLine[]; label: string }) {
  return (
    // A scrollable region must be reachable by keyboard to be usable, hence the tabIndex.
    <pre
      dir="ltr"
      lang="en"
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto px-4 py-4 text-start font-mono text-[13px] leading-6 whitespace-pre -outline-offset-2 focus-visible:outline-[#a5b4fc]"
    >
      <code>
        {lines.map((line, index) => (
          <span key={index} className="block">
            {line.map((token, tokenIndex) => (
              <span key={tokenIndex} className={TOKEN_COLOR[token.kind]}>
                {token.text}
              </span>
            ))}
          </span>
        ))}
      </code>
    </pre>
  );
}

export interface ApiTeaserProps {
  i18n: Translator;
  snippet: SnippetOptions;
}

export function ApiTeaser({ i18n, snippet }: ApiTeaserProps) {
  const { t } = i18n;
  const request = requestLines(snippet);
  const response = responseLines(snippet);
  return (
    <Section id="api" tone="muted">
      <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
        <div className="grid content-start gap-6 lg:col-span-5">
          <SectionHeader
            id="api"
            align="start"
            eyebrow={t('landing.api.eyebrow')}
            title={t('landing.api.title')}
            description={t('landing.api.description')}
            className="max-w-none"
          />
          <ul className="grid gap-3">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-foreground">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success"
                >
                  <Check className="size-3.5" />
                </span>
                {t(point)}
              </li>
            ))}
          </ul>
          <div>
            <Button
              href="/docs"
              variant="secondary"
              size="lg"
              endIcon={
                <Directional>
                  <ArrowRight className="size-5" />
                </Directional>
              }
            >
              {t('landing.api.cta')}
            </Button>
          </div>
        </div>

        <div
          className={cn(
            'overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d1c] shadow-lg lg:col-span-7',
            styles.reveal,
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="hidden gap-1.5 sm:flex">
                <span className="size-2.5 rounded-full bg-white/20" />
                <span className="size-2.5 rounded-full bg-white/20" />
                <span className="size-2.5 rounded-full bg-white/20" />
              </span>
              <span className="truncate text-xs font-medium text-[#b4b4d0]">
                {t('landing.api.requestLabel')}
              </span>
            </div>
            <CopyButton
              text={snippetText(request)}
              label={t('landing.api.copy')}
              copiedLabel={t('landing.api.copied')}
              failedLabel={t('landing.api.copyFailed')}
            />
          </div>
          <Code lines={request} label={t('landing.api.requestLabel')} />
          <div className="border-t border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-[#b4b4d0]">
            {t('landing.api.responseLabel')}
          </div>
          <Code lines={response} label={t('landing.api.responseLabel')} />
        </div>
      </div>
    </Section>
  );
}

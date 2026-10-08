import { KeyRound } from 'lucide-react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { Button } from '@/components/ui/button';
import { formatPlainNumber } from '@/lib/utils';
import {
  CodeLanguageProvider,
  LanguageCode,
  LanguagePicker,
  type LanguageSample,
} from './code-language';
import { Section } from './concepts';
import type { DocsContext } from './docs-context';
import { Prose } from './prose';
import {
  HIGHLIGHT_AS,
  QUICKSTART_STEPS,
  quickstartCode,
  type QuickstartInput,
  type QuickstartLanguage,
  type QuickstartStep,
} from './snippets';
import { highlight } from './tokenize';

export interface QuickstartProps {
  ctx: DocsContext;
  input: QuickstartInput;
  /** Credits the example generation costs. */
  cost: number;
  initialLanguage: QuickstartLanguage;
}

function samplesOf(
  code: Record<QuickstartLanguage, string>,
): Record<QuickstartLanguage, LanguageSample> {
  const sample = (language: QuickstartLanguage): LanguageSample => ({
    lines: highlight(code[language], HIGHLIGHT_AS[language]),
    text: code[language],
  });
  return { bash: sample('bash'), javascript: sample('javascript'), python: sample('python') };
}

/**
 * Four steps from nothing to a downloaded image, with the code in the reader's language of choice
 * (kept in a cookie). The prose is localized; the code is the same everywhere.
 */
export function Quickstart({ ctx, input, cost, initialLanguage }: QuickstartProps) {
  const { t } = ctx.i18n;
  const code = quickstartCode(input);
  const vars = { model: input.modelId, cost: creditsLabel(ctx.i18n, cost) };
  return (
    <Section
      id="quickstart"
      title={t('account.docs.quickstart.title')}
      lead={t('account.docs.quickstart.lead', vars)}
    >
      <CodeLanguageProvider initial={initialLanguage}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <LanguagePicker label={t('account.docs.quickstart.language')} />
          <p className="text-sm text-muted">{t('account.docs.quickstart.requirements')}</p>
        </div>
        <ol className="grid gap-9">
          {QUICKSTART_STEPS.map((step: QuickstartStep, index) => (
            <li
              key={step}
              id={`quickstart-${step}`}
              className="grid scroll-mt-32 gap-3 lg:scroll-mt-24"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand"
                >
                  {formatPlainNumber(index + 1, ctx.i18n.locale)}
                </span>
                <h3 className="text-lg font-semibold text-foreground">
                  {t(`account.docs.quickstart.steps.${step}.title`)}
                </h3>
              </div>
              <div className="grid gap-3 ps-0 sm:ps-11">
                <Prose text={t(`account.docs.quickstart.steps.${step}.body`, vars)} />
                {step === 'setup' ? (
                  <div>
                    <Button
                      href="/account?tab=keys"
                      variant="secondary"
                      size="sm"
                      startIcon={<KeyRound aria-hidden="true" className="size-4" />}
                    >
                      {t('account.docs.quickstart.createKey')}
                    </Button>
                  </div>
                ) : null}
                <LanguageCode
                  samples={samplesOf(code[step])}
                  scope={t(`account.docs.quickstart.steps.${step}.title`)}
                  labels={ctx.codeLabels}
                />
              </div>
            </li>
          ))}
        </ol>
      </CodeLanguageProvider>
    </Section>
  );
}

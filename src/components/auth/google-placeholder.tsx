'use client';

import { useId } from 'react';
import { ConsentLine } from '@/components/legal/consent-line';
import { buttonVariants } from '@/components/ui/button-variants';
import { useI18n } from '@/lib/i18n/client';
import { GoogleLogo, OrDivider } from './google-parts';

/** The commands are the same in every language: only the words around them are translated. */
const SETUP_PROGRAM = 'npm';
const SETUP_PROGRAM_POWERSHELL = 'npm.cmd';

const codeClass =
  'block max-w-full rounded-lg border border-border bg-surface px-3 py-2 text-start font-mono text-xs leading-5 break-words whitespace-normal text-foreground';

/** `npm run setup:firebase -- --signin-only`; on a narrow screen it wraps before the flag, never inside it. */
function SetupCommand({ program }: { program: string }) {
  return (
    <code dir="ltr" className={codeClass}>
      {`${program} run setup:firebase -- `}
      <span className="whitespace-nowrap">--signin-only</span>
    </code>
  );
}

export interface GoogleSignInPlaceholderProps {
  /** Same as on the real button: the sign-in page says that a first Google sign-in creates an account. */
  showConsent?: boolean;
  /** `id` of text that describes the button (the consent line on the register page). */
  describedBy?: string;
}

/**
 * Stands where "Continue with Google" will be while Google sign-in is not set up, in development
 * only (see `showGoogleSetupPlaceholder`). It is deliberately not a working button: it looks
 * unavailable, has no click handler and says in words what to run. It keeps the real button's place
 * and the divider under it, so the page looks the way it will once the identifiers are set.
 */
export function GoogleSignInPlaceholder({
  showConsent,
  describedBy,
}: GoogleSignInPlaceholderProps) {
  const { t } = useI18n();
  const noteId = `google-setup-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-2xl border-2 border-dashed border-border-strong p-3">
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={[noteId, describedBy].filter(Boolean).join(' ')}
          className={buttonVariants({ variant: 'secondary', size: 'lg', fullWidth: true })}
        >
          <GoogleLogo />
          {t('auth.google.button')}
        </button>
        <div id={noteId} className="grid gap-2 text-sm text-muted">
          <p className="font-semibold text-foreground">{t('auth.google.dev.title')}</p>
          <p>{t('auth.google.dev.note')}</p>
          <SetupCommand program={SETUP_PROGRAM} />
          <p>{t('auth.google.dev.powershell')}</p>
          <SetupCommand program={SETUP_PROGRAM_POWERSHELL} />
          <p>{t('auth.google.dev.after')}</p>
        </div>
      </div>
      {showConsent ? <ConsentLine /> : null}
      <OrDivider />
    </div>
  );
}

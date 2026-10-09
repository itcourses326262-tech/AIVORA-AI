'use client';

import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CodeWindow } from '@/components/docs/code-window';
import { highlight } from '@/components/docs/tokenize';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import type { ApiKeyDTO, CreateApiKeyRequest, CreateApiKeyResponse } from '@/lib/api-types';
import { errorCodeOf } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/client';
import { failureText, issuePaths, sessionEnded } from './form-errors';

export interface KeyLimits {
  /** Active keys one account may hold. */
  maxActive: number;
  /** Longest key name, in characters. */
  nameMax: number;
}

const characters = (text: string): number => [...text].length;

export interface CreateKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limits: KeyLimits;
  /** The server made the key: the full secret is in the response and nowhere else. */
  onCreated: (created: CreateApiKeyResponse) => void;
}

/** Asks for a name and creates the key. Field and limit problems are shown where they belong. */
export function CreateKeyDialog({ open, onOpenChange, limits, onCreated }: CreateKeyDialogProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const router = useRouter();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function change(next: boolean) {
    if (busy) return;
    onOpenChange(next);
    if (!next) {
      setName('');
      setNameError(null);
      setFormError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError(t('account.keys.errors.nameRequired'));
      return;
    }
    if (characters(trimmed) > limits.nameMax) {
      setNameError(t('account.keys.errors.nameTooLong', { max: limits.nameMax }));
      return;
    }

    setBusy(true);
    try {
      const body: CreateApiKeyRequest = { name: trimmed };
      const created = await api.post<CreateApiKeyResponse>('/keys', body);
      setName('');
      onCreated(created);
    } catch (error) {
      if (sessionEnded(error)) router.refresh();
      if (issuePaths(error).has('name')) setNameError(t('account.keys.errors.nameInvalid'));
      else if (errorCodeOf(error) === 'conflict') {
        setFormError(t('account.keys.errors.limit', { max: limits.maxActive }));
      } else if (errorCodeOf(error) === 'email_not_verified') {
        // The generic text is about creating generations; here it is about keys.
        setFormError(t('account.keys.errors.emailNotVerified'));
      } else setFormError(failureText(error, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={change}
      dismissible={!busy}
      title={t('account.keys.createDialog.title')}
      description={t('account.keys.createDialog.description')}
    >
      <form noValidate onSubmit={(event) => void submit(event)} className="grid grid-cols-1 gap-4">
        <FormError>{formError}</FormError>
        <Field
          label={t('account.keys.createDialog.name')}
          hint={t('account.keys.createDialog.nameHint', { max: limits.nameMax })}
          error={nameError}
          required
        >
          <Input
            name="name"
            data-autofocus=""
            autoComplete="off"
            placeholder={t('account.keys.createDialog.namePlaceholder')}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
            }}
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => change(false)}>
            {t('account.keys.createDialog.cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {busy
              ? t('account.keys.createDialog.submitting')
              : t('account.keys.createDialog.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const COPIED_MS = 2500;

export interface RevealKeyDialogProps {
  /** The key as it was just created; null while the dialog is closed. */
  created: CreateApiKeyResponse | null;
  origin: string;
  onDone: () => void;
}

/**
 * Shows the new key exactly once, with a plain warning and a copy button that confirms. It cannot
 * be dismissed by accident (no Escape, no backdrop click, no close button): only the button that
 * says the key is stored closes it.
 */
export function RevealKeyDialog({ created, origin, onDone }: RevealKeyDialogProps) {
  const { t } = useI18n();
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Which key was copied, not whether one was: a dialog opened for the next key starts unconfirmed.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copied = created !== null && copiedKey === created.key;

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
    } catch {
      // The clipboard is refused (insecure page, permissions): leave the key selected to copy by hand.
      field.current?.select();
      toast.error(t('account.keys.reveal.copyFailed'));
      return;
    }
    setCopiedKey(created.key);
    toast.success(t('account.keys.reveal.copiedToast'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiedKey(null), COPIED_MS);
  }

  const command = created
    ? `curl "${origin}/api/v1/account" \\\n  -H "Authorization: Bearer ${created.key}"`
    : '';
  return (
    <Dialog
      open={created !== null}
      onOpenChange={() => undefined}
      role="alertdialog"
      size="lg"
      dismissible={false}
      showClose={false}
      title={t('account.keys.reveal.title')}
      description={t('account.keys.reveal.warningTitle')}
    >
      {created ? (
        <div className="grid grid-cols-1 gap-4">
          <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-3 text-sm text-foreground">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>{t('account.keys.reveal.warning')}</p>
          </div>
          <Field label={t('account.keys.reveal.keyLabel')}>
            <div className="flex flex-wrap gap-2">
              <Input
                ref={field}
                readOnly
                dir="ltr"
                value={created.key}
                className="font-mono rtl:text-end"
                boxClassName="min-w-0 flex-1"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                variant={copied ? 'secondary' : 'primary'}
                data-autofocus=""
                onClick={() => void copy()}
                startIcon={
                  copied ? (
                    <Check aria-hidden="true" className="size-4 text-success" />
                  ) : (
                    <Copy aria-hidden="true" className="size-4" />
                  )
                }
              >
                {copied ? t('account.keys.reveal.copied') : t('account.keys.reveal.copy')}
              </Button>
            </div>
          </Field>
          <span role="status" className="sr-only">
            {copied ? t('account.keys.reveal.copiedToast') : ''}
          </span>
          <div className="grid grid-cols-1 gap-2">
            <p className="text-sm text-muted">{t('account.keys.reveal.usage')}</p>
            <CodeWindow
              lines={highlight(command, 'bash')}
              text={command}
              title="cURL"
              scope={t('account.keys.reveal.title')}
              labels={{
                copy: t('common.actions.copy'),
                copied: t('common.actions.copied'),
                copyFailed: t('account.keys.reveal.copyFailed'),
              }}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={onDone}>{t('account.keys.reveal.done')}</Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

export interface RevokeKeyDialogProps {
  /** The key being asked about; null closes the dialog. */
  target: ApiKeyDTO | null;
  onClose: () => void;
  onRevoked: (id: string) => void;
}

/** A confirmation: revoking cannot be undone, and whatever uses the key stops at once. */
export function RevokeKeyDialog({ target, onClose, onRevoked }: RevokeKeyDialogProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the last key while the dialog fades out, so its title does not flash empty.
  const [shown, setShown] = useState<ApiKeyDTO | null>(target);
  if (target && target !== shown) setShown(target);
  const key = target ?? shown;

  async function confirm() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/keys/${target.id}`);
      toast.success(t('account.keys.revoked'));
      onRevoked(target.id);
      onClose();
    } catch (failure) {
      if (sessionEnded(failure)) router.refresh();
      // Already gone: the list is out of date, not the action wrong.
      if (errorCodeOf(failure) === 'not_found') {
        onRevoked(target.id);
        onClose();
      } else setError(failureText(failure, i18n));
    } finally {
      setBusy(false);
    }
  }

  function change(open: boolean) {
    if (busy || open) return;
    setError(null);
    onClose();
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={change}
      role="alertdialog"
      dismissible={!busy}
      title={t('account.keys.revokeTitle', { name: key?.name ?? '' })}
      description={t('account.keys.revokeBody')}
    >
      <div className="grid grid-cols-1 gap-4">
        <FormError>{error}</FormError>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => change(false)}>
            {t('account.keys.cancel')}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            {busy ? t('account.keys.revoking') : t('account.keys.revokeConfirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

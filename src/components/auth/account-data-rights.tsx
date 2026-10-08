'use client';

import { Download, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { errorMessage } from '@/components/ui/error-message';
import { Field } from '@/components/ui/field';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api-client';
import { errorCodeOf } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils';
import { useUser } from '@/lib/user-context';

const EXPORT_FALLBACK_NAME = 'aivore-export.json';

/** `filename="…"` out of a Content-Disposition header, or the fallback. */
function filenameOf(disposition: string | null): string {
  const match = /filename="([^"\\/]{1,120})"/.exec(disposition ?? '');
  return match?.[1] ?? EXPORT_FALLBACK_NAME;
}

/** The server's message for a failed download is JSON with an error code; anything else is generic. */
async function failureOf(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error)) return { code: body.error.code };
  } catch {
    // Not JSON: fall through to the status.
  }
  return { code: response.status === 429 ? 'rate_limited' : 'internal' };
}

function ExportCard() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const response = await fetch('/api/v1/account/export', {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        toast.error(errorMessage(t, await failureOf(response)));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameOf(response.headers.get('content-disposition'));
      document.body.append(link);
      link.click();
      link.remove();
      // The click starts the download from the blob; release it a moment later.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error(t('auth.dataRights.export.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">{t('auth.dataRights.export.title')}</CardTitle>
        <CardDescription>{t('auth.dataRights.export.description')}</CardDescription>
      </CardHeader>
      <div className="p-5">
        <Button
          variant="secondary"
          loading={busy}
          startIcon={<Download aria-hidden="true" className="size-4" />}
          onClick={() => void download()}
        >
          {busy ? t('auth.dataRights.export.preparing') : t('auth.dataRights.export.button')}
        </Button>
      </div>
    </Card>
  );
}

function DeleteCard() {
  const i18n = useI18n();
  const { t } = i18n;
  const { creditBalance } = useUser();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function close(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setPassword('');
      setFieldError(null);
      setFormError(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || password === '') return;
    setBusy(true);
    setFieldError(null);
    setFormError(null);
    api
      .delete('/account', { body: { password } })
      .then(() => {
        router.replace('/');
        router.refresh();
      })
      .catch((error: unknown) => {
        setBusy(false);
        const code = errorCodeOf(error);
        if (code === 'validation_failed') setFieldError(t('auth.dataRights.delete.wrongPassword'));
        else if (code === 'provider_error') setFormError(t('auth.dataRights.delete.billingError'));
        else setFormError(errorMessage(t, isApiError(error) ? error : { code }));
      });
  }

  return (
    <Card className="border-danger/30">
      <CardHeader>
        <CardTitle as="h3">{t('auth.dataRights.delete.title')}</CardTitle>
        <CardDescription>{t('auth.dataRights.delete.description')}</CardDescription>
      </CardHeader>
      <div className="p-5">
        <Button
          variant="outline"
          className="border-danger/40 text-danger"
          startIcon={<Trash2 aria-hidden="true" className="size-4" />}
          onClick={() => setOpen(true)}
        >
          {t('auth.dataRights.delete.button')}
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={close}
        role="alertdialog"
        dismissible={!busy}
        title={t('auth.dataRights.delete.confirmTitle')}
        description={t('auth.dataRights.delete.confirmBody', {
          credits: creditsLabel(i18n, creditBalance),
        })}
      >
        <form noValidate onSubmit={submit} className="grid gap-4">
          <FormError>{formError}</FormError>
          <Field label={t('auth.dataRights.delete.passwordLabel')} error={fieldError} required>
            <Input
              name="password"
              type="password"
              dir="ltr"
              className="rtl:text-end"
              autoComplete="current-password"
              autoCapitalize="none"
              spellCheck={false}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFieldError(null);
              }}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => close(false)}>
              {t('auth.dataRights.delete.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={password === ''}>
              {busy ? t('auth.dataRights.delete.submitting') : t('auth.dataRights.delete.submit')}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

/**
 * The two privacy controls of the account page: download everything we hold, and delete the
 * account (password re-entry, a confirmation dialog that says what is lost). Mount it inside the
 * app shell (it reads the balance from `useUser()`); it brings its own cards.
 */
export function AccountDataRights() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ExportCard />
      <DeleteCard />
    </div>
  );
}

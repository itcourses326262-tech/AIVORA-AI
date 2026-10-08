'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PasswordField } from '@/components/auth/password-field';
import { scorePassword } from '@/components/auth/password-strength';
import { PasswordStrengthMeter } from '@/components/auth/password-strength-meter';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/components/auth/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/form-error';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import type { ChangePasswordRequest } from '@/lib/api-types';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';
import { failureText, issuePaths, sessionEnded } from './form-errors';

interface Errors {
  current?: string;
  next?: string;
}

/**
 * Current password, new password and a strength meter. A wrong current password and a refused new
 * one are pinned to their fields; the server signs the other devices out (this one stays).
 */
function PasswordForm() {
  const i18n = useI18n();
  const { t } = i18n;
  const { user } = useUser();
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function validate(): Errors {
    const found: Errors = {};
    if (current === '') found.current = t('account.security.errors.currentRequired');
    if (next === '') found.next = t('auth.validation.passwordRequired');
    else if (next.length < PASSWORD_MIN_LENGTH) {
      found.next = t('auth.validation.passwordTooShort', { min: PASSWORD_MIN_LENGTH });
    } else if (next.length > PASSWORD_MAX_LENGTH) {
      found.next = t('auth.validation.passwordTooLong', { max: PASSWORD_MAX_LENGTH });
    }
    return found;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (found.current || found.next) return;

    setSaving(true);
    try {
      const body: ChangePasswordRequest = { currentPassword: current, newPassword: next };
      await api.post('/account/password', body);
      setCurrent('');
      setNext('');
      toast.success(t('account.security.success'));
    } catch (error) {
      if (sessionEnded(error)) router.refresh();
      const paths = issuePaths(error);
      if (paths.has('currentPassword')) {
        setErrors({ current: t('account.security.errors.currentWrong') });
      } else if (paths.has('newPassword')) {
        setErrors({ next: t('account.security.errors.same') });
      } else if (paths.has('password')) {
        setErrors({ next: t('auth.errors.passwordRejected') });
      } else {
        setFormError(failureText(error, i18n));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('account.security.passwordTitle')}</CardTitle>
        <CardDescription>{t('account.security.passwordDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="grid max-w-xl grid-cols-1 gap-5"
        >
          <FormError>{formError}</FormError>
          {/* A password manager reads the account name next to the password it is asked to change. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={user?.email ?? ''}
            readOnly
            hidden
          />
          <PasswordField
            name="currentPassword"
            label={t('account.security.currentPassword')}
            value={current}
            onValueChange={(value) => {
              setCurrent(value);
              setErrors((previous) => ({ ...previous, current: undefined }));
            }}
            error={errors.current}
            autoComplete="current-password"
          />
          <PasswordField
            name="newPassword"
            label={t('account.security.newPassword')}
            value={next}
            onValueChange={(value) => {
              setNext(value);
              setErrors((previous) => ({ ...previous, next: undefined }));
            }}
            error={errors.next}
            autoComplete="new-password"
            hint={
              <>
                <span className="block">{t('auth.hints.password')}</span>
                <PasswordStrengthMeter strength={scorePassword(next, user?.email ?? '')} />
              </>
            }
          />
          <div>
            <Button type="submit" loading={saving}>
              {saving ? t('account.security.submitting') : t('account.security.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Ends every session of the account and sends this browser to the login page. */
function SignOutEverywhere() {
  const i18n = useI18n();
  const { t } = i18n;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) setError(null);
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/logout-all');
      toast.success(t('account.security.signedOut'));
      router.replace('/login');
      router.refresh();
    } catch (failure) {
      setBusy(false);
      if (sessionEnded(failure)) router.refresh();
      setError(failureText(failure, i18n));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('account.security.signOutTitle')}</CardTitle>
        <CardDescription>{t('account.security.signOutDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          startIcon={<LogOut aria-hidden="true" className="size-4" />}
          onClick={() => setOpen(true)}
        >
          {t('account.security.signOutButton')}
        </Button>
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={change}
        role="alertdialog"
        dismissible={!busy}
        title={t('account.security.signOutConfirmTitle')}
        description={t('account.security.signOutConfirmBody')}
      >
        <div className="grid grid-cols-1 gap-4">
          <FormError>{error}</FormError>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => change(false)}>
              {t('account.security.cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirm()}>
              {busy ? t('account.security.signingOut') : t('account.security.signOutConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

export function SecurityPanel() {
  return (
    <div className="grid grid-cols-1 gap-5">
      <PasswordForm />
      <SignOutEverywhere />
    </div>
  );
}

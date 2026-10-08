'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { NAME_MAX_LENGTH } from '@/components/auth/schemas';
import { useLocaleSwitch } from '@/components/layout/preferences';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import type { UpdateAccountRequest, UserDTO } from '@/lib/api-types';
import { LOCALES, isLocale, type Locale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';
import { failureText, issuePaths, sessionEnded } from './form-errors';

const characters = (text: string): number => [...text].length;

/**
 * Name and language of the account. Only what changed is sent. A new language is also written to
 * the locale cookie (by the server's answer and again here), and the page is rendered again, so the
 * whole interface switches at once.
 */
export function ProfilePanel() {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const { user, refresh } = useUser();
  const router = useRouter();
  const { setLocale } = useLocaleSwitch();
  const languageLabelId = useId();

  const [name, setName] = useState(user?.name ?? '');
  // The language shown is the one the interface speaks now; saving makes the account remember it.
  const [language, setLanguage] = useState<Locale>(locale);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return null;
  const trimmed = name.trim();
  const dirty = trimmed !== user.name || language !== user.locale;

  function validate(): boolean {
    if (trimmed === '') {
      setNameError(t('account.profile.errors.nameRequired'));
      return false;
    }
    if (characters(trimmed) > NAME_MAX_LENGTH) {
      setNameError(t('account.profile.errors.nameTooLong', { max: NAME_MAX_LENGTH }));
      return false;
    }
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !user) return;
    setFormError(null);
    if (!validate()) return;
    const patch: UpdateAccountRequest = {};
    if (trimmed !== user.name) patch.name = trimmed;
    if (language !== user.locale) patch.locale = language;
    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    try {
      await api.patch<UserDTO>('/account', patch);
      toast.success(t('account.profile.saved'));
      setName(patch.name ?? trimmed);
      await refresh();
      if (patch.locale !== undefined && patch.locale !== locale) setLocale(patch.locale);
      else router.refresh();
    } catch (error) {
      if (sessionEnded(error)) router.refresh();
      const paths = issuePaths(error);
      if (paths.has('name')) setNameError(t('account.profile.errors.nameInvalid'));
      else setFormError(failureText(error, i18n));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('account.profile.title')}</CardTitle>
        <CardDescription>{t('account.profile.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="grid max-w-xl grid-cols-1 gap-5"
        >
          <FormError>{formError}</FormError>
          <Field
            label={t('account.profile.name')}
            hint={t('account.profile.nameHint', { max: NAME_MAX_LENGTH })}
            error={nameError}
            required
          >
            <Input
              name="name"
              autoComplete="name"
              placeholder={t('account.profile.namePlaceholder')}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
            />
          </Field>
          <Field label={t('account.profile.email')} hint={t('account.profile.emailHint')}>
            <Input
              name="email"
              type="email"
              dir="ltr"
              className="rtl:text-end"
              readOnly
              value={user.email}
            />
          </Field>
          <div className="grid grid-cols-1 gap-1.5">
            <span id={languageLabelId} className="text-sm font-medium text-foreground">
              {t('account.profile.language')}
            </span>
            <RadioGroup
              aria-labelledby={languageLabelId}
              appearance="card"
              orientation="horizontal"
              value={language}
              onValueChange={(next) => {
                if (isLocale(next)) setLanguage(next);
              }}
              options={LOCALES.map((code) => ({
                value: code,
                label: <span lang={code}>{t(`common.language.${code}`)}</span>,
              }))}
            />
            <p className="text-sm text-muted">{t('account.profile.languageHint')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={saving} disabled={!dirty}>
              {saving ? t('account.profile.saving') : t('account.profile.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

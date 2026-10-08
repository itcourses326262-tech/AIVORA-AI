import { Button, Field, Input } from '@/components/ui';
import { getI18n } from '@/lib/i18n/server';

export default async function KitAuthPage() {
  const { t } = await getI18n();
  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <h1 className="text-2xl font-semibold">{t('auth.login.title')}</h1>
        <p className="text-sm text-muted">{t('auth.login.subtitle')}</p>
      </div>
      <form className="grid gap-4">
        <Field label={t('auth.fields.email')} required>
          <Input type="email" placeholder={t('auth.fields.emailPlaceholder')} />
        </Field>
        <Field label={t('auth.fields.password')} required>
          <Input type="password" />
        </Field>
        <Button type="submit" size="lg" fullWidth>
          {t('auth.login.submit')}
        </Button>
      </form>
    </div>
  );
}

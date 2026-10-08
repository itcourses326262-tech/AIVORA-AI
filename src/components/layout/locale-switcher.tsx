'use client';

import { Languages } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '../ui/button-variants';
import { DropdownMenu, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '../ui/dropdown-menu';
import { LOCALES } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/client';
import { useLocaleSwitch } from './preferences';

/** Each language is written in itself and tagged with `lang`, so it is read correctly either way. */
export function LocaleSwitcher({ className }: { className?: string }) {
  const { t } = useI18n();
  const { locale, pending, setLocale } = useLocaleSwitch();
  return (
    <DropdownMenu
      label={t('common.language.label')}
      align="end"
      trigger={
        <button
          type="button"
          aria-label={`${t('common.language.label')}: ${t(`common.language.${locale}`)}`}
          aria-busy={pending || undefined}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'md' }),
            'gap-2 px-2.5 sm:px-3 [&_svg]:size-[1.125rem]',
            className,
          )}
        >
          <Languages aria-hidden="true" />
          <span lang={locale} className="hidden sm:inline">
            {t(`common.language.${locale}`)}
          </span>
        </button>
      }
    >
      <DropdownMenuRadioGroup
        label={t('common.language.label')}
        value={locale}
        onValueChange={setLocale}
      >
        {LOCALES.map((code) => (
          <DropdownMenuRadioItem key={code} value={code}>
            <span lang={code}>{t(`common.language.${code}`)}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
}

'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { THEMES } from '@/lib/theme';
import { useI18n } from '@/lib/i18n/client';
import { DropdownMenu, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '../ui/dropdown-menu';
import { IconButton } from '../ui/icon-button';
import { useThemeSwitch } from './preferences';

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Light, Dark or System. The trigger shows the current choice by CSS on `<html data-theme>`, so
 * the server-rendered icon is right from the first paint, with no flash or hydration mismatch.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const { theme, setTheme } = useThemeSwitch();
  return (
    <DropdownMenu
      label={t('common.theme.label')}
      align="end"
      trigger={
        <IconButton label={t('common.theme.label')} tooltip={false} className={className}>
          <span className="relative block size-5" aria-hidden="true">
            <Sun className="absolute inset-0 hidden size-5 [[data-theme=light]_&]:block" />
            <Moon className="absolute inset-0 hidden size-5 [[data-theme=dark]_&]:block" />
            <Monitor className="absolute inset-0 hidden size-5 [[data-theme=system]_&]:block" />
          </span>
        </IconButton>
      }
    >
      <DropdownMenuRadioGroup
        label={t('common.theme.label')}
        value={theme}
        onValueChange={setTheme}
      >
        {THEMES.map((name) => {
          const Icon = ICONS[name];
          return (
            <DropdownMenuRadioItem key={name} value={name}>
              <span className="flex items-center gap-2.5">
                <Icon aria-hidden="true" className="size-4 text-muted" />
                {t(`common.theme.${name}`)}
              </span>
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
}

'use client';

import { CircleUserRound, Images, Loader, LogOut, WandSparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { LOCALES } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/client';
import { THEMES } from '@/lib/theme';
import { useUser } from '@/lib/user-context';
import { Avatar } from '../ui/avatar';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { errorMessage } from '../ui/error-message';
import { toast } from '../ui/toast';
import { useLocaleSwitch, useThemeSwitch } from './preferences';

export interface UserMenuProps {
  /**
   * Include links to Studio, Gallery and Account. The app shell already has them in its sidebar
   * and tab bar, so it leaves them out; the public header needs them.
   */
  navigation?: boolean;
  /**
   * Include the language and theme choices in the menu. The app shell has no other switchers (the
   * top bar is crowded on a phone); the marketing header shows them next to the menu instead.
   */
  preferences?: boolean;
}

/** The avatar button with the account menu: account, language, theme and log out. */
export function UserMenu({ navigation = true, preferences = true }: UserMenuProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useUser();
  const { locale, setLocale } = useLocaleSwitch();
  const { theme, setTheme } = useThemeSwitch();
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) return null;

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.post('/auth/logout');
    } catch (error) {
      setLoggingOut(false);
      toast.error(errorMessage(t, error));
      return;
    }
    router.replace('/');
    router.refresh();
    toast.success(t('common.toast.loggedOut'));
  };

  return (
    <DropdownMenu
      label={t('common.a11y.userMenu')}
      align="end"
      trigger={
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-full transition-transform duration-150 hover:scale-105 active:scale-95 pointer-coarse:size-11"
        >
          {/* Named by its content, not by an aria-label: the initials in the avatar are a picture,
              and a label that does not contain the visible text fails "label in name". */}
          <span className="sr-only">{t('common.a11y.userMenu')}</span>
          <Avatar name={user.name} aria-hidden="true" />
        </button>
      }
    >
      <DropdownMenuLabel className="grid gap-0.5 px-2.5 py-2">
        <span className="text-xs text-subtle">{t('common.user.signedInAs')}</span>
        <span className="truncate text-sm font-semibold text-foreground">{user.name}</span>
        <span className="truncate text-xs font-normal text-muted">
          {/* An isolated LTR run inside the block's own direction: the address reads left to right
              but lines up with the name and the label above it (start edge, right in Arabic). */}
          <bdi dir="ltr">{user.email}</bdi>
        </span>
      </DropdownMenuLabel>
      {navigation ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem href="/studio">
            <WandSparkles aria-hidden="true" />
            {t('common.nav.studio')}
          </DropdownMenuItem>
          <DropdownMenuItem href="/gallery">
            <Images aria-hidden="true" />
            {t('common.nav.gallery')}
          </DropdownMenuItem>
          <DropdownMenuItem href="/account">
            <CircleUserRound aria-hidden="true" />
            {t('common.nav.account')}
          </DropdownMenuItem>
        </>
      ) : null}
      {preferences ? (
        <>
          <DropdownMenuSeparator />
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
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            label={t('common.theme.label')}
            value={theme}
            onValueChange={setTheme}
          >
            {THEMES.map((name) => (
              <DropdownMenuRadioItem key={name} value={name}>
                {t(`common.theme.${name}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem destructive onSelect={() => void logout()}>
        {loggingOut ? (
          <Loader aria-hidden="true" className="animate-spinner" />
        ) : (
          <LogOut aria-hidden="true" className="rtl:-scale-x-100" />
        )}
        {t('common.nav.logout')}
      </DropdownMenuItem>
    </DropdownMenu>
  );
}

import 'server-only';
import { cookies } from 'next/headers';
import { DEFAULT_THEME, THEME_COOKIE, isTheme, type Theme } from './theme';

/** Theme of the current request: the `aivore_theme` cookie, else dark. */
export async function getTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : DEFAULT_THEME;
}

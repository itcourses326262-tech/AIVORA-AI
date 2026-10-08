/** Remembers whether the desktop sidebar is collapsed, so the server renders it that way (no jump). */
export const SIDEBAR_COOKIE = 'aivore_sidebar';

export type SidebarState = 'collapsed' | 'expanded';

export function isSidebarState(value: unknown): value is SidebarState {
  return value === 'collapsed' || value === 'expanded';
}

export function serializeSidebarCookie(
  state: SidebarState,
  options: { secure?: boolean } = {},
): string {
  const parts = [
    `${SIDEBAR_COOKIE}=${state}`,
    'Path=/',
    `Max-Age=${60 * 60 * 24 * 365}`,
    'SameSite=Lax',
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

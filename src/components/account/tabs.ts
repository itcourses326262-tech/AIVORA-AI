export const ACCOUNT_TABS = ['profile', 'security', 'credits', 'keys', 'data'] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];

export function isAccountTab(value: unknown): value is AccountTab {
  return (ACCOUNT_TABS as readonly unknown[]).includes(value);
}

/** `?tab=keys` of a link or the address bar; anything else (or nothing) opens the profile. */
export function parseAccountTab(value: string | readonly string[] | undefined): AccountTab {
  const first = typeof value === 'string' ? value : value?.[0];
  return isAccountTab(first) ? first : 'profile';
}

/** The address of a tab: the profile is the plain `/account`, the others add `?tab=`. */
export function accountHref(tab: AccountTab): string {
  return tab === 'profile' ? '/account' : `/account?tab=${tab}`;
}

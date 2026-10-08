import {
  CircleUserRound,
  CodeXml,
  Compass,
  Images,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '@/lib/i18n';

export interface NavItem {
  href: string;
  label: MessageKey;
  /** Shorter label for the mobile tab bar, where five items share 360px. */
  shortLabel?: MessageKey;
  icon: LucideIcon;
}

/** The signed-in app: sidebar on desktop, tab bar on mobile. */
export const APP_NAV: readonly NavItem[] = [
  { href: '/studio', label: 'common.nav.studio', icon: WandSparkles },
  { href: '/gallery', label: 'common.nav.gallery', icon: Images },
  { href: '/explore', label: 'common.nav.explore', icon: Compass },
  { href: '/account', label: 'common.nav.account', icon: CircleUserRound },
  { href: '/docs', label: 'common.nav.docs', shortLabel: 'common.nav.docsShort', icon: CodeXml },
];

/** The public site header. */
export const SITE_NAV: readonly NavItem[] = [
  { href: '/studio', label: 'common.nav.studio', icon: WandSparkles },
  { href: '/explore', label: 'common.nav.explore', icon: Compass },
  { href: '/docs', label: 'common.nav.docs', icon: CodeXml },
];

/** A link is active on its own page and on everything below it (`/gallery/gen_1` keeps Gallery lit). */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

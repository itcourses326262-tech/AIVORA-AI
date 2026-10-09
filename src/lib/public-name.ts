/**
 * How an account name appears to people who are not the account: its first word only. The share
 * panel promises "your first name", so the public API (`owner.name`), Explore and the share page
 * all go through here.
 */

const MAX_FIRST_NAME_CHARS = 24;
// Invisible characters that arrive with pasted names: zero-width space, left/right marks,
// embeddings and isolates, and the byte order mark.
const INVISIBLE = /[​‎‏‪-‮⁦-⁩﻿]/g;

/**
 * The first word of an account name, ready to show. Null for nothing usable: an empty name, or a
 * word that looks like an email address or a link, which people sometimes type as their name.
 */
export function firstNameOf(name: string | null | undefined): string | null {
  const word = (name ?? '').normalize('NFC').replace(INVISIBLE, '').trim().split(/\s+/u)[0] ?? '';
  if (word === '' || /[@/\\]/.test(word)) return null;
  return Array.from(word).slice(0, MAX_FIRST_NAME_CHARS).join('');
}

export type StrengthLevel = 'empty' | 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordStrength {
  level: StrengthLevel;
  /** 0 (nothing typed) to 4 (strong): how many of the meter's segments are lit. */
  score: 0 | 1 | 2 | 3 | 4;
}

const COMMON = [
  'password',
  'passw0rd',
  '12345678',
  '123456789',
  '1234567890',
  'qwertyui',
  'qwerty123',
  'iloveyou',
  'letmein',
  'welcome',
  'admin123',
  'abc12345',
  '11111111',
  'aivore',
];

const SEQUENCES = [
  '0123456789',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

function hasSequence(value: string): boolean {
  const lower = value.toLowerCase();
  return SEQUENCES.some((sequence) => {
    for (let index = 0; index + 4 <= sequence.length; index += 1) {
      const piece = sequence.slice(index, index + 4);
      if (lower.includes(piece) || lower.includes([...piece].reverse().join(''))) return true;
    }
    return false;
  });
}

/**
 * A rough, honest estimate for the meter next to the password field: length first, then variety,
 * with a penalty for the usual giveaways (a common password, one repeated character, a keyboard
 * or alphabet run, the address itself). It is advice only; the server enforces the real policy.
 */
export function scorePassword(password: string, email = ''): PasswordStrength {
  if (password.length === 0) return { level: 'empty', score: 0 };

  const classes = [
    /\p{Ll}/u.test(password) || /\p{Lo}/u.test(password),
    /\p{Lu}/u.test(password),
    /\p{N}/u.test(password),
    /[^\p{L}\p{N}]/u.test(password),
  ].filter(Boolean).length;

  let points = 0;
  for (const length of [8, 10, 12, 16]) if (password.length >= length) points += 1;
  for (const wanted of [2, 3, 4]) if (classes >= wanted) points += 1;

  const lower = password.toLowerCase();
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  const giveaways =
    COMMON.some((word) => lower.includes(word)) ||
    /^(.)\1+$/u.test(password) ||
    hasSequence(password) ||
    (local.length >= 4 && lower.includes(local));
  if (giveaways) points -= 2;

  // Below the minimum length nothing else matters.
  if (password.length < 8 || points <= 2) return { level: 'weak', score: 1 };
  if (points === 3) return { level: 'fair', score: 2 };
  if (points <= 5) return { level: 'good', score: 3 };
  return { level: 'strong', score: 4 };
}

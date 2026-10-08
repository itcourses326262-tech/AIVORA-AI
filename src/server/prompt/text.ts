import 'server-only';
import { hasArabicScript } from '@/server/moderation/normalize';

export { hasArabicScript };

/** Share of the letters in `text` that are Arabic (0 when there are no letters). */
export function arabicLetterRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const arabic = letters.filter((letter) => hasArabicScript(letter)).length;
  return arabic / letters.length;
}

import { describe, expect, it } from 'vitest';
import { createLocalMatcher, getLocalMatcher } from '@/server/moderation/matcher';
import {
  CATEGORY_REASONS,
  COMBO_RULES,
  MODERATION_CATEGORIES,
  SAFE_PHRASES,
  TERM_RULES,
  type ModerationCategory,
} from '@/server/moderation/terms';

const matcher = createLocalMatcher();
const check = (text: string) => matcher.check(text);
const rank = (category: ModerationCategory | null) =>
  category === null ? Number.POSITIVE_INFINITY : MODERATION_CATEGORIES.indexOf(category);

describe('categories', () => {
  it.each<[ModerationCategory, string]>([
    ['sexual_minors', 'a naked child'],
    ['sexual_minors', 'sexy teenager in lingerie'],
    ['sexual_minors', 'nsfw loli'],
    ['sexual_minors', 'child porn'],
    ['sexual_minors', 'a nude 12 year old'],
    ['sexual_minors', 'nude 9yo'],
    ['sexual_minors', 'طفل عاري'],
    ['sexual_minors', 'صور جنسية للأطفال'],
    ['sexual_minors', 'مراهقة اباحية'],
    ['sexual_explicit', 'free porn video'],
    ['sexual_explicit', 'hardcore hentai'],
    ['sexual_explicit', 'a naked woman on the beach'],
    ['sexual_explicit', 'nude men and women'],
    ['sexual_explicit', 'two people having sex'],
    ['sexual_explicit', 'سكس'],
    ['sexual_explicit', 'فيلم إباحي'],
    ['sexual_explicit', 'الفتاة العارية'],
    ['sexual_explicit', 'امرأة عارية على الشاطئ'],
    ['non_consensual_sexual', 'deepfake porn of her'],
    ['non_consensual_sexual', 'nude photo of my ex'],
    ['non_consensual_sexual', 'make this photo naked'],
    ['non_consensual_sexual', 'a rape scene'],
    ['non_consensual_sexual', 'undress ai'],
    ['non_consensual_sexual', 'اغتصاب'],
    ['non_consensual_sexual', 'ديب فيك صورة'],
    ['graphic_violence', 'gore everywhere, dismembered bodies'],
    ['graphic_violence', 'a beheading'],
    ['graphic_violence', 'severed heads on pikes'],
    ['graphic_violence', 'اشلاء بشرية'],
    ['graphic_violence', 'قطع الرأس'],
    ['hate', 'kill all muslims'],
    ['hate', 'death to the jews'],
    ['hate', 'wipe out the immigrants'],
    ['hate', 'heil hitler rally'],
    ['hate', 'الموت للمسلمين'],
    ['hate', 'اقتلوا اليهود'],
    ['terrorism', 'how to make a bomb'],
    ['terrorism', 'join isis poster'],
    ['terrorism', 'terrorist recruitment video'],
    ['terrorism', 'انضم الى داعش'],
  ])('%s: "%s"', (category, text) => {
    expect(check(text)).toBe(category);
  });

  it('reports the most serious category when several apply', () => {
    expect(check('naked child porn with gore')).toBe('sexual_minors');
    expect(check('porn with gore')).toBe('sexual_explicit');
    expect(check('gore and kill all muslims')).toBe('graphic_violence');
  });

  it('has a generic reason for every category', () => {
    for (const category of MODERATION_CATEGORIES) {
      expect(CATEGORY_REASONS[category].length).toBeGreaterThan(10);
    }
  });
});

describe('bypass attempts', () => {
  it.each([
    ['plain', 'porn'],
    ['upper case', 'PORN'],
    ['spaced letters', 'p o r n'],
    ['spaced with extra spaces and a leading article', 'a   p  o   r   n   video'],
    ['dots', 'p.o.r.n'],
    ['hyphens', 'p-o-r-n'],
    ['underscores', 's_e_x tape'],
    ['partly spaced', 'po rn'],
    ['partly spaced, other split', 'por n'],
    ['zero-width space', 'po​rn'],
    ['zero-width joiner', 'p‍o‍r‍n'],
    ['soft hyphen', 'po­rn'],
    ['right-to-left override', 'p‮orn'],
    ['Cyrillic o and p', 'рoоrn'],
    ['Greek omicron and rho', 'ροrn'],
    ['fullwidth', 'ｐｏｒｎ'],
    ['circled letters', 'Ⓟⓞⓡⓝ'],
    ['math bold', '𝐏𝐎𝐑𝐍'],
    ['small caps', 'ᴘᴏʀɴ'],
    ['accents', 'pôrñ'],
    ['repeated letters', 'pooooorn'],
    ['repeated letters everywhere', 'ppoorrnn'],
    ['leetspeak zero', 'p0rn'],
    ['leetspeak spelling', 'pr0n'],
    ['leetspeak chain', 'h3nt41'],
    ['symbols', '$ex tape'],
    ['plural', 'porns'],
    ['inside a sentence', 'please make me a fun, little p.o.r.n.o video'],
  ])('still catches %s', (_label, text) => {
    expect(check(text), text).not.toBeNull();
  });

  it.each([
    ['tatweel', 'سـ ـكـ ـس'],
    ['tatweel inside', 'ســـكس'],
    ['diacritics', 'سَكْس'],
    ['spaced letters', 'س ك س'],
    ['repeated letters', 'سككككس'],
    ['presentation forms', 'ﺳﻜﺲ'],
    ['zero-width characters', 'س​ك‍س'],
    ['hamza variants', 'إباحيّ'],
    ['clitics', 'والسكس'],
    ['feminine ending written with heh', 'اباحيه'],
    ['Arabic-Indic digits for an age', 'طفلة عمرها ١٠ سكس'],
  ])('still catches Arabic: %s', (_label, text) => {
    expect(check(text), text).not.toBeNull();
  });

  it('catches mixed-script obfuscation of a combination', () => {
    expect(check('n u d e   g i r l')).toBe('sexual_explicit');
    expect(check('n.u.d.e  c-h-i-l-d')).toBe('sexual_minors');
    expect(check('naked 𝐜𝐡𝐢𝐥𝐝')).toBe('sexual_minors');
    expect(check('nаked wоman')).toBe('sexual_explicit');
  });

  it('catches a stated age under 18 written many ways', () => {
    for (const text of [
      'naked 12 year old',
      'naked 12-year-old',
      'naked 12yo',
      'naked 12 y.o.',
      'naked aged 9',
    ]) {
      expect(check(text), text).toBe('sexual_minors');
    }
  });

  it('is not defeated by padding with harmless words', () => {
    const padding = 'a calm lake at dawn with mountains '.repeat(100);
    expect(check(`${padding} p o r n ${padding}`)).toBe('sexual_explicit');
  });
});

describe('false-positive guards (Scunthorpe)', () => {
  it.each([
    'Scunthorpe',
    'Essex, Sussex and Middlesex',
    'a sextant and a sextet',
    'grape juice and a drape',
    'a therapist and a pharmacist',
    'analysis of the classic assassin',
    'a cocktail and a peacock',
    'a bass guitar next to a glass',
    'rapeseed field in bloom',
    'a trapeze artist',
    'Hancock and Dickens',
    'cucumber and document',
    'Sussex spaniel',
    'the passage to a class',
  ])('does not block "%s"', (text) => {
    expect(check(text), text).toBeNull();
  });

  it.each([
    'a naked mole rat in its burrow',
    'a woman wearing nude lipstick and a nude palette',
    'a man looking at the stars with the naked eye',
    'a girl and a naked mole rat',
    'a child playing in the park',
    'a teen reading a book on a bench',
    'a kid with a dog',
    'a baby sleeping in a crib',
    '12 year old boy riding a bike',
    'a 30 year old woman wearing a red dress',
    'sexual education poster for adults',
    'a woman cooking chicken breasts',
    'a naked tree in winter',
    'bare feet on the sand',
    'Al Gore giving a speech',
    'a Gore-Tex jacket on a mountain',
    'kill all humans, said the robot',
    'death to the patriarchy poster',
    'a soldier fighting a dragon',
    'a battle scene with swords',
    'the rape of the lock by Pope',
    'spic and span kitchen',
    'Scarlett Johansson style portrait',
    '4k 8k 1080p 16:9 ultra detailed',
    'a beautiful sunset over the sea',
  ])('does not block "%s"', (text) => {
    expect(check(text), text).toBeNull();
  });

  it.each([
    'منظر طبيعي خلاب',
    'امرأة جميلة تقف في الحديقة',
    'طفل يلعب بالكرة في الحديقة',
    'الجنسية المصرية',
    'جنسية',
    'رجل يرتدي ملابس رسمية',
    'بنت صغيرة تقرأ كتابا',
    'عاري من الصحة', // an idiom ("baseless") with no person word
    'قطة تجلس على الاريكة',
    'تحية للجميع',
  ])('does not block Arabic "%s"', (text) => {
    expect(check(text), text).toBeNull();
  });

  it('needs the two halves of a combination close together', () => {
    expect(
      check('naked mole rat lives in a burrow while a woman watches from far away'),
    ).toBeNull();
    expect(check('a woman watches a naked mole rat')).toBeNull();
    expect(check('naked woman')).toBe('sexual_explicit');
  });

  it('does not pair a word with itself', () => {
    expect(check('sexual')).toBeNull();
    expect(check('child')).toBeNull();
    expect(check('nude')).toBeNull();
  });

  it('does not match a part of a longer word', () => {
    expect(check('kiddo')).toBeNull();
    expect(check('nudest')).toBeNull();
    expect(check('pornucopia')).toBeNull();
  });
});

describe('extra terms (MODERATION_BLOCKLIST)', () => {
  const custom = createLocalMatcher(['Forbidden Word', 'Zorp', 'ممنوع']);

  it('blocks them as the blocklist category, case-insensitively', () => {
    expect(custom.check('a forbidden word here')).toBe('blocklist');
    expect(custom.check('ZORP!')).toBe('blocklist');
    expect(custom.check('zorps')).toBe('blocklist');
    expect(custom.check('هذا ممنوع')).toBe('blocklist');
    expect(custom.check('للممنوع')).toBe('blocklist');
  });

  it('matches whole tokens only', () => {
    expect(custom.check('zorpington')).toBeNull();
    expect(custom.check('forbidden')).toBeNull();
    expect(custom.check('a forbidden, long word')).toBeNull();
  });

  it('resists the same obfuscation as the built-in terms', () => {
    expect(custom.check('z.o.r.p')).toBe('blocklist');
    expect(custom.check('z​orp')).toBe('blocklist');
    expect(custom.check('ᴢᴏʀᴘ')).toBe('blocklist');
  });

  it('ranks below the built-in categories', () => {
    expect(custom.check('zorp porn')).toBe('sexual_explicit');
  });

  it('ignores entries that normalize to nothing', () => {
    const empty = createLocalMatcher(['', '   ', '!!!', '​']);
    expect(empty.check('a red fox')).toBeNull();
  });

  it('does not change the built-in matcher', () => {
    expect(check('zorp')).toBeNull();
  });

  it('caches compiled matchers per blocklist', () => {
    expect(getLocalMatcher(['alpha'])).toBe(getLocalMatcher(['alpha']));
    expect(getLocalMatcher(['alpha'])).not.toBe(getLocalMatcher(['beta']));
    expect(getLocalMatcher()).toBe(getLocalMatcher([]));
  });
});

describe('rule data', () => {
  it('has a term or combination for every category except the blocklist', () => {
    for (const category of MODERATION_CATEGORIES) {
      if (category === 'blocklist') continue;
      const has =
        TERM_RULES.some((rule) => rule.category === category) ||
        COMBO_RULES.some((rule) => rule.category === category);
      expect(has, category).toBe(true);
    }
  });

  it('covers English and Arabic in the explicit, gore, hate and terrorism categories', () => {
    const arabic = /[؀-ۿ]/;
    for (const category of ['sexual_explicit', 'graphic_violence', 'terrorism'] as const) {
      const terms = TERM_RULES.filter((rule) => rule.category === category).flatMap(
        (rule) => rule.terms,
      );
      expect(
        terms.some((term) => arabic.test(term)),
        category,
      ).toBe(true);
      expect(
        terms.some((term) => !arabic.test(term)),
        category,
      ).toBe(true);
    }
    const hate = COMBO_RULES.filter((rule) => rule.category === 'hate');
    expect(hate.some((rule) => rule.b.some((term) => arabic.test(term)))).toBe(true);
    expect(hate.some((rule) => rule.b.some((term) => !arabic.test(term)))).toBe(true);
  });

  it('blocks every term of every rule on its own', () => {
    for (const rule of TERM_RULES) {
      for (const term of rule.terms) {
        expect(rank(check(term)), `${rule.category}: ${term}`).toBeLessThanOrEqual(
          rank(rule.category),
        );
      }
    }
  });

  it('blocks every pair of every combination', () => {
    for (const rule of COMBO_RULES) {
      for (const a of rule.a) {
        for (const b of rule.b) {
          const hit = check(`${a} ${b}`);
          const reverse = check(`${b} ${a}`);
          // A pair may also be a more serious category (shared vocabulary), never a less serious one.
          expect(rank(hit), `${rule.category}: ${a} + ${b}`).toBeLessThanOrEqual(
            rank(rule.category),
          );
          expect(rank(reverse), `${rule.category}: ${b} + ${a}`).toBeLessThanOrEqual(
            rank(rule.category),
          );
        }
      }
    }
  });

  it('does not block its own known-safe phrases', () => {
    for (const phrase of SAFE_PHRASES) expect(check(phrase), phrase).toBeNull();
  });

  it('still blocks a term that appears next to a safe phrase', () => {
    expect(check('Al Gore and gore everywhere')).toBe('graphic_violence');
  });
});

describe('robustness and speed', () => {
  it('handles empty and symbol-only input', () => {
    for (const text of ['', ' ', '!!!', '🙂🙂', '​​', '12345']) {
      expect(check(text)).toBeNull();
    }
  });

  it('handles very long input quickly', () => {
    const words = 'a beautiful woman in a red dress standing on the beach at sunset ';
    const started = performance.now();
    expect(check(words.repeat(3000))).toBeNull();
    expect(check(`${words.repeat(3000)} p o r n`)).toBe('sexual_explicit');
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('handles long runs of single letters quickly', () => {
    const started = performance.now();
    expect(check('a b c d e f g h i j k l m n o p q r s t u v w x y z '.repeat(200))).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('is deterministic across repeated calls', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(check('naked woman')).toBe('sexual_explicit');
      expect(check('sunset')).toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { SIDEBAR_COOKIE } from '@/components/layout/sidebar-cookie';
import { anchorOf, documentOf, sectionIdsOf } from '@/components/legal/outline';
import type { MessageTree } from '@/lib/i18n/define';
import { LOCALE_COOKIE } from '@/lib/i18n/locales';
import legal from '@/lib/i18n/messages/legal';
import legalDocuments from '@/lib/i18n/messages/legal-documents';
import { COMPANY_FIELDS, LEGAL_LINK_TARGETS, LEGAL_MESSAGE_KEY, LEGAL_SLUGS } from '@/lib/legal';
import { THEME_COOKIE } from '@/lib/theme';
import { TOKEN_TTL_MS } from '@/server/auth/email-tokens';
import { SESSION_ABSOLUTE_MAX_MS, SESSION_TTL_MS } from '@/server/auth/sessions';
import { SESSION_COOKIE_NAME } from '@/server/http/request';
import { MODERATION_CATEGORIES, type ModerationCategory } from '@/server/moderation/terms';
import {
  SRC_ROOT,
  linkTargetsOf,
  readSource,
  repoPath,
  sourceFilesUnder,
  tokensOf,
} from './support';

const DOCUMENTS = LEGAL_SLUGS.map((slug) => LEGAL_MESSAGE_KEY[slug]);
const NUMBER_TOKENS = ['vatPercent', 'leadDays', 'graceDays', 'refundDays'];
const KNOWN_TOKENS = new Set<string>([...COMPANY_FIELDS, 'confirm', ...NUMBER_TOKENS]);
const ARABIC = /[؀-ۿ]/;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type Language = 'en' | 'ar';
const LANGUAGES: Language[] = ['en', 'ar'];

function bodyOf(language: Language, document: (typeof DOCUMENTS)[number], id: string): string {
  const sections = legalDocuments[language][document].sections as Record<string, { body: string }>;
  return sections[id]?.body ?? '';
}

function sectionsOf(language: Language, document: (typeof DOCUMENTS)[number]) {
  return Object.entries(
    legalDocuments[language][document].sections as Record<string, MessageTree>,
  ).map(([id, section]) => ({ id, title: String(section.title), body: String(section.body) }));
}

/** Digits as the Arabic text writes them (Arabic-Indic). */
const arabicDigits = (value: number) =>
  String(value).replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)] ?? digit);

describe.each(DOCUMENTS)('legal.%s dictionary', (document) => {
  it('has the same sections in the same order in both languages', () => {
    const en = Object.keys(legalDocuments.en[document].sections);
    const ar = Object.keys(legalDocuments.ar[document].sections);
    expect(ar).toEqual(en);
    expect(en.length).toBeGreaterThanOrEqual(5);
  });

  it('gives every section a unique, URL-safe anchor', () => {
    const anchors = sectionIdsOf(document).map(anchorOf);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const anchor of anchors) expect(anchor).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it.each(LANGUAGES)(
    '(%s) has a title and a body in every section, and no stray markup',
    (language) => {
      for (const { id, title, body } of sectionsOf(language, document)) {
        expect(title.trim(), `${id} title`).not.toBe('');
        expect(title.length, `${id} title length`).toBeLessThanOrEqual(80);
        expect(body.trim().length, `${id} body`).toBeGreaterThan(40);
        // Balanced bold and code markers, no raw HTML, no leftovers of a template.
        expect((body.match(/\*\*/g) ?? []).length % 2, `${id}: ** pairs`).toBe(0);
        expect((body.match(/\[\[/g) ?? []).length, `${id}: [[ ]] pairs`).toBe(
          (body.match(/\]\]/g) ?? []).length,
        );
        expect(body, `${id}: HTML`).not.toMatch(/<\/?[a-z][^>]*>/i);
        expect(body, `${id}: placeholder text`).not.toMatch(/lorem|TODO|FIXME|xxx|\{\{|\}\}/i);
        expect(body, `${id}: unfinished list item`).not.toMatch(/^\s*-\s*$/m);
      }
    },
  );

  it('writes Arabic as Arabic and English as English', () => {
    for (const { id, title, body } of sectionsOf('ar', document)) {
      expect(title, `${id} title`).toMatch(ARABIC);
      expect(body, `${id} body`).toMatch(ARABIC);
    }
    for (const { id, title, body } of sectionsOf('en', document)) {
      expect(`${title} ${body}`, id).not.toMatch(ARABIC);
    }
  });

  it('uses only tokens the renderer knows, and the same ones in both languages', () => {
    for (const { id } of sectionsOf('en', document)) {
      const en = tokensOf(bodyOf('en', document, id));
      const ar = tokensOf(bodyOf('ar', document, id));
      for (const token of [...en, ...ar])
        expect(KNOWN_TOKENS.has(token), `${id}: {${token}}`).toBe(true);
      expect([...ar].sort(), id).toEqual([...en].sort());
    }
  });

  it('links only to pages the renderer allows, and to the same ones in both languages', () => {
    for (const { id } of sectionsOf('en', document)) {
      const en = linkTargetsOf(bodyOf('en', document, id));
      const ar = linkTargetsOf(bodyOf('ar', document, id));
      for (const target of [...en, ...ar]) {
        expect(LEGAL_LINK_TARGETS, `${id}: ${target}`).toContain(target);
      }
      expect([...ar].sort(), id).toEqual([...en].sort());
    }
  });

  it('flags at least one decision for counsel, since it is a draft', () => {
    for (const language of LANGUAGES) {
      const all = sectionsOf(language, document)
        .map((section) => section.body)
        .join('\n');
      expect(tokensOf(all)).toContain('confirm');
    }
  });

  it('has a title, summary and search-engine description in both languages', () => {
    for (const language of LANGUAGES) {
      const doc = legalDocuments[language][document];
      expect(doc.title.length).toBeGreaterThan(3);
      expect(doc.summary.length).toBeGreaterThan(40);
      expect(doc.meta.title).toBe(doc.title);
      expect(doc.meta.description.length).toBeGreaterThan(40);
      expect(doc.meta.description.length).toBeLessThanOrEqual(200);
    }
  });

  it('reads every section, in order, through documentOf', () => {
    for (const locale of LANGUAGES) {
      const text = documentOf(locale, document);
      expect(text.sections.map((section) => section.id)).toEqual(sectionIdsOf(document));
      expect(text.title).toBe(legalDocuments[locale][document].title);
      expect(text.metaDescription).toBe(legalDocuments[locale][document].meta.description);
      for (const section of text.sections) {
        expect(section.title.length, `${locale} ${section.id}`).toBeGreaterThan(2);
        expect(section.body.length, `${locale} ${section.id}`).toBeGreaterThan(40);
      }
    }
  });
});

describe('what each document covers', () => {
  const ids = (document: (typeof DOCUMENTS)[number]) => sectionIdsOf(document);

  it('terms: account, credits, plans, outputs, acceptable use, termination, liability, law, changes', () => {
    expect(ids('terms')).toEqual(
      expect.arrayContaining([
        'account',
        'credits',
        'plans',
        'outputs',
        'yourContent',
        'acceptableUse',
        'termination',
        'liability',
        'law',
        'changes',
      ]),
    );
  });

  it('terms: credits never expire and are not transferable, plans renew and cancel, prices can change', () => {
    const credits = bodyOf('en', 'terms', 'credits');
    expect(credits).toMatch(/never expire/i);
    expect(credits).toMatch(/cannot be transferred/i);
    const plans = bodyOf('en', 'terms', 'plans');
    expect(plans).toMatch(/cancel/i);
    expect(plans).toMatch(/renew/i);
    expect(plans).toMatch(/price changes/i);
    const arCredits = bodyOf('ar', 'terms', 'credits');
    expect(arCredits).toContain('لا تنتهي صلاحية الرصيد');
    expect(arCredits).toContain('تحويله');
  });

  it('terms: outputs may be inaccurate or similar, ownership is between user and us and defers to model providers', () => {
    const outputs = bodyOf('en', 'terms', 'outputs');
    expect(outputs).toMatch(/inaccurate/i);
    expect(outputs).toMatch(/similar/i);
    expect(outputs).toMatch(/you own the outputs/i);
    expect(outputs).toMatch(/third-party model providers/i);
    expect(outputs).toMatch(/responsible for the prompts/i);
  });

  it('terms: the governing law is Saudi Arabia, flagged for confirmation', () => {
    const law = bodyOf('en', 'terms', 'law');
    expect(law).toContain('Kingdom of Saudi Arabia {confirm}');
    expect(bodyOf('ar', 'terms', 'law')).toContain('المملكة العربية السعودية');
  });

  it('privacy: data, cookies, sharing, retention, rights, security, children, contact', () => {
    expect(ids('privacy')).toEqual(
      expect.arrayContaining([
        'controller',
        'data',
        'use',
        'cookies',
        'sharing',
        'transfers',
        'retention',
        'rights',
        'security',
        'children',
        'contact',
      ]),
    );
  });

  it('privacy: names the processors and says card numbers never reach us', () => {
    for (const language of LANGUAGES) {
      const sharing = bodyOf(language, 'privacy', 'sharing');
      expect(sharing).toContain('fal.ai');
      expect(sharing).toContain('Moyasar');
    }
    expect(bodyOf('en', 'privacy', 'sharing')).toMatch(/never see your card number/);
    expect(bodyOf('en', 'privacy', 'sharing')).toMatch(/email provider/i);
    expect(bodyOf('en', 'privacy', 'data')).toMatch(/IP address/);
    expect(bodyOf('en', 'privacy', 'data')).toMatch(/user agent/);
    expect(bodyOf('en', 'privacy', 'data')).toMatch(/prompts/);
  });

  it('privacy: rights point at the account settings that exist (export and deletion)', () => {
    expect(bodyOf('en', 'privacy', 'rights')).toMatch(/\[account settings\]\(\/account\)/);
    expect(bodyOf('en', 'privacy', 'rights')).toMatch(/download a copy/i);
    expect(bodyOf('en', 'privacy', 'rights')).toMatch(/delete your account/i);
    expect(bodyOf('ar', 'privacy', 'rights')).toContain('(/account)');
  });

  it('refunds: failed generations come back automatically, packs, plans, chargebacks', () => {
    expect(ids('refunds')).toEqual(
      expect.arrayContaining(['failed', 'packs', 'plans', 'request', 'payout', 'disputes']),
    );
    expect(bodyOf('en', 'refunds', 'failed')).toMatch(/returned to your balance automatically/);
    expect(bodyOf('en', 'refunds', 'disputes')).toMatch(/chargeback/i);
    expect(bodyOf('en', 'refunds', 'payout')).toContain('Moyasar');
    expect(bodyOf('ar', 'refunds', 'failed')).toContain('تلقائيًا');
  });

  it('acceptable use: every category of the brief, enforcement and how to report', () => {
    const prohibited = bodyOf('en', 'acceptableUse', 'prohibited');
    for (const phrase of [
      /involving minors/i,
      /non-consensual/i,
      /deepfake/i,
      /impersonation/i,
      /terrorism/i,
      /hate/i,
      /illegal content/i,
      /infringement/i,
    ]) {
      expect(prohibited).toMatch(phrase);
    }
    expect(bodyOf('en', 'acceptableUse', 'misuse')).toMatch(/spam/i);
    expect(bodyOf('en', 'acceptableUse', 'misuse')).toMatch(/API/);
    const arProhibited = bodyOf('ar', 'acceptableUse', 'prohibited');
    for (const phrase of [
      'القاصرين',
      'التزييف العميق',
      'انتحال',
      'الإرهاب',
      'الكراهية',
      'غير المشروع',
      'الانتهاك',
    ]) {
      expect(arProhibited).toContain(phrase);
    }
    expect(ids('acceptableUse')).toEqual(
      expect.arrayContaining(['moderation', 'enforcement', 'report']),
    );
    expect(tokensOf(bodyOf('en', 'acceptableUse', 'report'))).toContain('contactEmail');
  });

  it('every refund and billing number in the text is a token, never typed in', () => {
    // The VAT rate, the renewal lead time, the grace period and the refund window come from code.
    for (const language of LANGUAGES) {
      const plans = bodyOf(language, 'terms', 'plans');
      expect(tokensOf(plans)).toEqual(
        expect.arrayContaining(['vatPercent', 'leadDays', 'graceDays']),
      );
      expect(tokensOf(bodyOf(language, 'refunds', 'packs'))).toContain('refundDays');
    }
  });
});

describe('the documents match what the system does', () => {
  it('lists exactly the cookies the app sets, and no others', () => {
    const real = [SESSION_COOKIE_NAME, LOCALE_COOKIE, THEME_COOKIE, SIDEBAR_COOKIE].sort();
    for (const language of LANGUAGES) {
      const cookies = bodyOf(language, 'privacy', 'cookies');
      const named = [...cookies.matchAll(/\[\[(\w+)\]\]/g)].map((match) => match[1]).sort();
      expect(named, language).toEqual(real);
    }
  });

  it('states the real session lifetimes', () => {
    const idleDays = SESSION_TTL_MS / DAY_MS;
    const maxDays = SESSION_ABSOLUTE_MAX_MS / DAY_MS;
    const en = bodyOf('en', 'privacy', 'cookies');
    expect(en).toContain(`${idleDays} days without use`);
    expect(en).toContain(`${maxDays} days after you signed in`);
    const ar = bodyOf('ar', 'privacy', 'cookies');
    expect(ar).toContain(`بعد ${arabicDigits(idleDays)} يومًا دون استخدام`);
    expect(ar).toContain(`بحد أقصى ${arabicDigits(maxDays)} يومًا`);
    expect(bodyOf('en', 'privacy', 'retention')).toContain(`${idleDays} days without use`);
    expect(bodyOf('ar', 'privacy', 'retention')).toContain(arabicDigits(idleDays));
  });

  it('states the real lifetimes of the emailed links', () => {
    const verifyHours = TOKEN_TTL_MS.verify / HOUR_MS;
    const resetHours = TOKEN_TTL_MS.reset / HOUR_MS;
    expect(verifyHours).toBe(24);
    expect(resetHours).toBe(1);
    const en = bodyOf('en', 'privacy', 'retention');
    expect(en).toContain(`after ${verifyHours} hours`);
    expect(en).toContain(`after ${resetHours} hour,`);
    const ar = bodyOf('ar', 'privacy', 'retention');
    expect(ar).toContain(`بعد ${arabicDigits(verifyHours)} ساعة`);
    expect(ar).toContain('بعد ساعة واحدة');
  });
});

describe('the privacy policy covers every place the app writes to the browser', () => {
  const DOCUMENTS_FILE = 'src/lib/i18n/messages/legal-documents.ts';
  const code = sourceFilesUnder(SRC_ROOT).filter((path) => repoPath(path) !== DOCUMENTS_FILE);

  it('names a cookie in the code only if the policy lists it (a new cookie fails this)', () => {
    const documented = [SESSION_COOKIE_NAME, LOCALE_COOKIE, THEME_COOKIE, SIDEBAR_COOKIE].sort();
    const inCode = new Set<string>();
    for (const path of code) {
      for (const match of readSource(path).matchAll(/\baivore_[a-z][a-z0-9_]*\b/g)) {
        inCode.add(match[0]);
      }
    }
    expect([...inCode].sort()).toEqual(documented);
  });

  it('writes cookies from the page only in the three places that write the documented ones', () => {
    const writers = code
      .filter((path) => /document\.cookie\s*=[^=]/.test(readSource(path)))
      .map(repoPath);
    expect(writers).toEqual([
      'src/components/layout/app-shell.tsx',
      'src/components/layout/preferences.ts',
      'src/lib/i18n/client.tsx',
    ]);
  });

  it('sets no cookie through the framework cookie store, which the policy would not know about', () => {
    const setters = code.filter((path) =>
      /cookies\(\)\.set|cookieStore\.set|\.cookies\.set\(/.test(readSource(path)),
    );
    expect(setters.map(repoPath)).toEqual([]);
  });

  it('uses web storage only for the studio settings, the docs code language and the gallery position', () => {
    const users = code
      .filter((path) =>
        /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem|clear)|window\.(?:localStorage|sessionStorage)/.test(
          readSource(path),
        ),
      )
      .map(repoPath);
    expect(users).toEqual([
      'src/components/docs/code-language-storage.ts',
      'src/components/gallery/nav-snapshot.ts',
      'src/components/studio/settings-storage.ts',
    ]);
  });

  it('says so, in both languages: local storage for settings and language, session storage for the gallery', () => {
    const en = bodyOf('en', 'privacy', 'cookies');
    expect(en).toMatch(/studio settings you used last/);
    expect(en).toMatch(/programming language you pick in the API documentation \(local storage\)/);
    expect(en).toMatch(/your place in the gallery while a tab is open \(session storage\)/);
    expect(en).toMatch(/never sent to us/);
    const ar = bodyOf('ar', 'privacy', 'cookies');
    expect(ar).toContain('آخر إعدادات استخدمتها في الاستوديو');
    expect(ar).toContain('(التخزين المحلي)');
    expect(ar).toContain('(تخزين الجلسة)');
    expect(ar).toContain('ولا تُرسل إلينا أبدًا');
  });
});

describe('retention: uploaded inputs', () => {
  const uploads = `${SRC_ROOT}/app/api/v1/uploads`;

  it('says an uploaded input image is kept until the account is deleted, not with its generation', () => {
    const en = bodyOf('en', 'privacy', 'retention');
    expect(en).toContain('Deleting a generation removes the results it created');
    expect(en).toContain(
      'Images you upload to use as inputs are kept until you delete your account; deleting a generation does not remove them.',
    );
    const ar = bodyOf('ar', 'privacy', 'retention');
    expect(ar).toContain('إزالة النتائج التي أنتجتها');
    expect(ar).toContain(
      'الصور التي ترفعها لتكون مدخلات للتوليد فتبقى حتى تحذف حسابك، ولا يزيلها حذف عملية التوليد',
    );
  });

  it('is true: the uploads API has no way to delete or list one, and a generation delete spares inputs', () => {
    // When per-upload deletion or a sweep of unused uploads is built, this fails: update the
    // retention clause (both languages) together with it.
    const route = readSource(`${uploads}/route.ts`);
    const methods = [
      ...route.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/g),
    ];
    expect(methods.map((match) => match[1])).toEqual(['POST']);
    const service = readSource(`${SRC_ROOT}/server/generations/service.ts`);
    expect(service).toContain('.where(eq(assets.generationId, id))');
    const insert = readSource(`${SRC_ROOT}/server/uploads/accept.ts`);
    expect(insert).toContain('generationId: null');
    expect(insert).toContain("role: 'input'");
  });
});

describe('the Acceptable Use Policy and the Terms cover everything the moderation blocks', () => {
  // One entry per category the moderation can block with. Typed on `ModerationCategory`, so a new
  // category does not compile until the documents (and this table) name it.
  const COVERAGE: Record<
    ModerationCategory,
    { aup: [RegExp, string]; terms: [RegExp, string] | null }
  > = {
    sexual_minors: {
      aup: [/Sexual content involving minors/, 'المحتوى الجنسي المتعلق بالقاصرين'],
      terms: [/sexual content involving minors/, 'محتوى جنسي يتعلق بالقاصرين'],
    },
    non_consensual_sexual: {
      aup: [/Non-consensual sexual content/, 'المحتوى الجنسي دون موافقة'],
      terms: [/images of real people made without their consent/, 'دون موافقتهم'],
    },
    sexual_explicit: {
      aup: [/Explicit sexual content/, 'المحتوى الجنسي الصريح'],
      terms: [/pornographic or sexually explicit content/, 'محتوى إباحي أو جنسي صريح'],
    },
    graphic_violence: {
      aup: [/Graphic violence and gore/, 'العنف المفرط والمشاهد الدموية'],
      terms: [/extremely graphic violence or gore/, 'عنف مفرط في بشاعته ومشاهد دموية'],
    },
    hate: {
      aup: [/incites hatred or discrimination/, 'يحرّض على الكراهية'],
      terms: [/hatred/, 'الكراهية'],
    },
    terrorism: {
      aup: [/Violence, terrorism and hate/, 'العنف والإرهاب والكراهية'],
      terms: [/terrorism/, 'الإرهاب'],
    },
    // The operator's own list of blocked words is not a content rule: the policy says it exists.
    blocklist: {
      aup: [/a list of blocked terms that we maintain/, 'قائمة مصطلحات محظورة نحتفظ بها'],
      terms: null,
    },
  };

  const aup = {
    en: sectionsOf('en', 'acceptableUse')
      .map((section) => section.body)
      .join('\n'),
    ar: sectionsOf('ar', 'acceptableUse')
      .map((section) => section.body)
      .join('\n'),
  };

  it('has an entry for every moderation category (and no stale one)', () => {
    expect(Object.keys(COVERAGE).sort()).toEqual([...MODERATION_CATEGORIES].sort());
  });

  it.each(MODERATION_CATEGORIES)(
    'names "%s" in the Acceptable Use Policy, in both languages',
    (category) => {
      const [english, arabic] = COVERAGE[category].aup;
      expect(aup.en, category).toMatch(english);
      expect(aup.ar, category).toContain(arabic);
    },
  );

  it.each(MODERATION_CATEGORIES)(
    'names "%s" in the Terms\' acceptable use section, in both languages',
    (category) => {
      const entry = COVERAGE[category].terms;
      if (entry === null) return;
      const [english, arabic] = entry;
      expect(bodyOf('en', 'terms', 'acceptableUse'), category).toMatch(english);
      expect(bodyOf('ar', 'terms', 'acceptableUse'), category).toContain(arabic);
    },
  );

  it('leaves the scope of explicit sexual content and gore to counsel: both bullets carry a "to confirm" flag', () => {
    for (const language of LANGUAGES) {
      const prohibited = bodyOf(language, 'acceptableUse', 'prohibited').split('\n');
      const terms = bodyOf(language, 'terms', 'acceptableUse').split('\n');
      const headings =
        language === 'en'
          ? ['**Explicit sexual content.**', '**Graphic violence and gore.**']
          : ['**المحتوى الجنسي الصريح.**', '**العنف المفرط والمشاهد الدموية.**'];
      for (const heading of headings) {
        const bullet = prohibited.find((line) => line.includes(heading));
        expect(bullet, `${language} ${heading}`).toBeDefined();
        expect(bullet, `${language} ${heading}`).toContain('{confirm}');
      }
      const termsBullet = terms.find((line) =>
        language === 'en' ? line.includes('pornographic') : line.includes('إباحي'),
      );
      expect(termsBullet, language).toContain('{confirm}');
    }
  });

  it('does not promise what no tool backs: reporting and review sentences are flagged for counsel', () => {
    const flagged = (
      language: Language,
      document: (typeof DOCUMENTS)[number],
      id: string,
      phrase: string,
    ) => {
      const line = bodyOf(language, document, id)
        .split('\n')
        .find((candidate) => candidate.includes(phrase));
      expect(line, `${language} ${id}: ${phrase}`).toBeDefined();
      expect(line, `${language} ${id}: ${phrase}`).toContain('{confirm}');
    };
    flagged('en', 'acceptableUse', 'prohibited', 'We have zero tolerance');
    flagged('en', 'acceptableUse', 'enforcement', 'child sexual abuse material');
    flagged('en', 'acceptableUse', 'moderation', 'our team may look at');
    flagged('ar', 'acceptableUse', 'prohibited', 'ولا نتسامح في ذلك إطلاقًا');
    flagged('ar', 'acceptableUse', 'enforcement', 'مواد الاعتداء الجنسي على الأطفال');
    flagged('ar', 'acceptableUse', 'moderation', 'قد يطّلع فريقنا');
    // "Always" is a promise nobody can keep without a report pipeline; the law-bound wording is not.
    expect(bodyOf('en', 'acceptableUse', 'enforcement')).not.toMatch(/\balways report\b/i);
    expect(bodyOf('ar', 'acceptableUse', 'enforcement')).not.toContain('نبلّغ دائمًا');
    expect(bodyOf('en', 'acceptableUse', 'enforcement')).toContain('where the law requires');
    expect(bodyOf('ar', 'acceptableUse', 'enforcement')).toContain('بالقدر الذي يوجبه النظام');
  });
});

describe('the extra namespaces', () => {
  it('has a label for every legal document in the navigation, footer and consent line', () => {
    for (const language of LANGUAGES) {
      expect(Object.keys(legal[language].nav).sort()).toEqual([...DOCUMENTS].sort());
      expect(legal[language].footer.title.length).toBeGreaterThan(2);
      const line = legal[language].consent.line;
      expect(line).toContain('{terms}');
      expect(line).toContain('{privacy}');
    }
  });

  it('has a placeholder label for every company detail, in both languages', () => {
    for (const language of LANGUAGES) {
      for (const field of COMPANY_FIELDS) {
        expect(legal[language].common.placeholder[field].length, field).toBeGreaterThan(2);
      }
      expect(legal[language].common.placeholder.missing).toContain('{label}');
    }
  });
});

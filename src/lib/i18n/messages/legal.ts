import { defineMessages } from '@/lib/i18n/define';

/**
 * The short legal strings the whole app uses: the names of the four documents (footer, consent line,
 * pricing and billing links), the labels of the legal pages, and the day counts the documents
 * quote. It is registered in `lib/i18n/index.ts`, so it is bundled for the client: keep it small.
 * The text of the documents themselves is in `messages/legal-documents.ts` (server only).
 */
export default defineMessages({
  en: {
    common: {
      eyebrow: 'Legal',
      lastUpdated: 'Last updated {date}',
      tocLabel: 'On this page',
      related: 'Other legal documents',
      draft: {
        title: 'Draft — pending legal review',
        body: 'This document is a template that a lawyer has not reviewed yet. It is not legal advice and it is not final. Highlighted items in brackets are company details that still have to be provided, and "To confirm" flags mark wording that needs a decision.',
      },
      placeholder: {
        missing: '[{label}: to be provided]',
        companyName: 'Company name',
        companyAddress: 'Company address',
        companyCr: 'Commercial registration number',
        vatNumber: 'VAT number',
        contactEmail: 'Contact email',
        supportEmail: 'Support email',
      },
      confirm: {
        short: 'To confirm',
        long: 'This wording needs to be confirmed by legal counsel',
      },
    },
    nav: {
      terms: 'Terms of Service',
      privacy: 'Privacy Policy',
      refunds: 'Refund Policy',
      acceptableUse: 'Acceptable Use Policy',
    },
    footer: {
      title: 'Legal',
    },
    consent: {
      line: 'By creating an account, you agree to the {terms} and the {privacy}.',
      newTab: 'opens in a new tab',
    },
    // A number of days as a phrase, in the plural form of each language (`components/legal/variables.ts`).
    days: {
      zero: '0 days',
      one: '1 day',
      two: '2 days',
      few: '{count} days',
      many: '{count} days',
      other: '{count} days',
    },
  },
  ar: {
    common: {
      eyebrow: 'الوثائق القانونية',
      lastUpdated: 'آخر تحديث: {date}',
      tocLabel: 'في هذه الصفحة',
      related: 'وثائق قانونية أخرى',
      draft: {
        title: 'مسودة — بانتظار المراجعة القانونية',
        body: 'هذه الوثيقة نموذج لم يراجعه محامٍ بعد، وهي ليست استشارة قانونية وليست نهائية. العناصر المظلَّلة بين قوسين بيانات لا تزال على الشركة تزويدها، وعلامات «للتأكيد» تشير إلى صياغة تحتاج إلى قرار.',
      },
      placeholder: {
        missing: '[{label}: يُستكمل لاحقًا]',
        companyName: 'اسم الشركة',
        companyAddress: 'عنوان الشركة',
        companyCr: 'رقم السجل التجاري',
        vatNumber: 'الرقم الضريبي',
        contactEmail: 'البريد الإلكتروني للتواصل',
        supportEmail: 'بريد الدعم',
      },
      confirm: {
        short: 'للتأكيد',
        long: 'تحتاج هذه الصياغة إلى تأكيد من مستشار قانوني',
      },
    },
    nav: {
      terms: 'شروط الخدمة',
      privacy: 'سياسة الخصوصية',
      refunds: 'سياسة الاسترداد',
      acceptableUse: 'سياسة الاستخدام المقبول',
    },
    footer: {
      title: 'الشروط والسياسات',
    },
    consent: {
      line: 'بإنشاء حسابك، فإنك توافق على {terms} و{privacy}.',
      newTab: 'يُفتح في تبويب جديد',
    },
    days: {
      zero: 'صفر أيام',
      one: 'يوم واحد',
      two: 'يومين',
      few: '{count} أيام',
      many: '{count} يومًا',
      other: '{count} يوم',
    },
  },
});

import type { AnyErrorCode } from '@/lib/errors';
import { defineMessages } from '@/lib/i18n/define';

// `satisfies` makes adding an error code to lib/errors.ts a compile error until both languages
// have a message for it.
type ErrorMessages = Record<AnyErrorCode | 'unknown', string>;

const en = {
  bad_request: 'The request could not be understood.',
  validation_failed: 'Some of the information you entered is not valid.',
  unauthorized: 'Please log in to continue.',
  forbidden: "You don't have permission to do that.",
  not_found: "We couldn't find what you were looking for.",
  conflict: 'This conflicts with the current state. Refresh the page and try again.',
  payload_too_large: 'The file or request is too large.',
  unsupported_media_type: "This file type isn't supported.",
  moderation_blocked: "This prompt can't be used because it goes against our content policy.",
  insufficient_credits: "You don't have enough credits for this.",
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  too_many_active:
    'You already have the maximum number of generations running. Wait for one to finish.',
  signup_disabled: 'New registrations are currently closed.',
  provider_error: 'The generation service ran into a problem. Please try again.',
  internal: 'Something went wrong on our side. Please try again.',
  network_error: "We can't reach the server. Check your connection and try again.",
  invalid_response: 'The server sent an unexpected response. Please try again.',
  unknown: 'Something went wrong.',
} satisfies ErrorMessages;

const ar = {
  bad_request: 'تعذّر فهم الطلب.',
  validation_failed: 'بعض المعلومات التي أدخلتها غير صالحة.',
  unauthorized: 'يرجى تسجيل الدخول للمتابعة.',
  forbidden: 'ليست لديك صلاحية للقيام بذلك.',
  not_found: 'لم نعثر على ما تبحث عنه.',
  conflict: 'يتعارض هذا الإجراء مع الحالة الحالية. حدّث الصفحة وحاول مرة أخرى.',
  payload_too_large: 'حجم الملف أو الطلب كبير جدًا.',
  unsupported_media_type: 'نوع هذا الملف غير مدعوم.',
  moderation_blocked: 'لا يمكن استخدام هذا الوصف لأنه يخالف سياسة المحتوى لدينا.',
  insufficient_credits: 'رصيدك غير كافٍ لإتمام هذا الطلب.',
  rate_limited: 'عدد الطلبات كبير جدًا. انتظر قليلًا ثم حاول مرة أخرى.',
  too_many_active: 'لديك الحد الأقصى من عمليات التوليد الجارية. انتظر حتى تنتهي إحداها.',
  signup_disabled: 'التسجيل مغلق حاليًا.',
  provider_error: 'واجهت خدمة التوليد مشكلة. حاول مرة أخرى.',
  internal: 'حدث خطأ من جانبنا. حاول مرة أخرى.',
  network_error: 'تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.',
  invalid_response: 'أرسل الخادم استجابة غير متوقعة. حاول مرة أخرى.',
  unknown: 'حدث خطأ ما.',
} satisfies ErrorMessages;

export default defineMessages({ en, ar });

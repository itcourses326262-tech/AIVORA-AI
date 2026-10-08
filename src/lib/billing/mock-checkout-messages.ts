import { defineMessages } from '@/lib/i18n/define';

/**
 * Text of the development-only fake payment page (`/billing/mock-checkout/[orderId]`). It lives
 * next to the billing code rather than in the app-wide dictionaries because the page does not
 * exist in production; `tests/lib/billing/mock-checkout-messages.test.ts` keeps both languages in step.
 */
export const mockCheckoutMessages = defineMessages({
  en: {
    pageTitle: 'Mock checkout',
    banner:
      'Development only. This page pretends to be the payment gateway: no card is charged and no real money moves.',
    heading: 'Complete your payment',
    item: 'You are buying',
    credits: 'Credits',
    monthly: 'billed monthly',
    vatIncluded: 'VAT included',
    total: 'Total',
    pay: 'Pay',
    fail: 'Fail the payment',
    hint: 'Pay simulates a successful payment; the other button simulates a declined one.',
    alreadyPaid: 'This order has already been paid.',
    closed: 'This checkout is closed and can no longer be paid.',
    lost: 'This mock checkout was lost when the server restarted. Start the purchase again.',
    back: 'Back to AIVORE',
  },
  ar: {
    pageTitle: 'صفحة دفع تجريبية',
    banner:
      'للتطوير فقط. هذه الصفحة تحاكي بوابة الدفع: لا يُخصم أي مبلغ من أي بطاقة ولا تنتقل أموال حقيقية.',
    heading: 'أكمل عملية الدفع',
    item: 'أنت تشتري',
    credits: 'الرصيد',
    monthly: 'يُحصَّل شهريًا',
    vatIncluded: 'شامل ضريبة القيمة المضافة',
    total: 'الإجمالي',
    pay: 'ادفع',
    fail: 'أفشِل الدفع',
    hint: 'زر «ادفع» يحاكي عملية دفع ناجحة، والزر الآخر يحاكي رفض عملية الدفع.',
    alreadyPaid: 'تم دفع هذا الطلب بالفعل.',
    closed: 'تم إغلاق عملية الدفع هذه ولا يمكن سدادها بعد الآن.',
    lost: 'فُقدت صفحة الدفع التجريبية هذه عند إعادة تشغيل الخادم. ابدأ عملية الشراء من جديد.',
    back: 'العودة إلى AIVORE',
  },
});

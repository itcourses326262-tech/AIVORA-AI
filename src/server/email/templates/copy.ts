import { defineMessages } from '@/lib/i18n/define';

/**
 * Wording of every email, in both languages. `defineMessages` forces identical key shapes, and
 * `tests/server/email/copy.test.ts` checks identical `{placeholders}`. Values are filled in and
 * escaped by `render.ts`; nothing here is trusted markup.
 */
export const emailCopy = defineMessages({
  en: {
    brand: 'AIVORE',
    shared: {
      linkHint: 'Button not working? Copy this link into your browser:',
      sentTo: 'This message was sent to {email} because of activity on your AIVORE account.',
      greeting: 'Hi {name},',
    },
    verification: {
      subject: 'Confirm your email address for AIVORE',
      preheader: 'One quick step and you can start creating.',
      heading: 'Confirm your email',
      intro:
        'Thanks for signing up for AIVORE. Confirm that {email} is your address to activate your account.',
      bonus: 'Confirming adds your sign-up bonus of {credits} to your balance.',
      action: 'Confirm email',
      expiry: 'This link works for {duration} and can be used once.',
      ignore: "If you didn't create an AIVORE account, you can ignore this email.",
    },
    passwordReset: {
      subject: 'Reset your AIVORE password',
      preheader: 'We received a request to reset your password.',
      heading: 'Reset your password',
      intro:
        'We received a request to reset the password of your account ({email}). Use the button below to choose a new one.',
      action: 'Choose a new password',
      expiry: 'This link works for {duration} and can be used once.',
      ignore: "If you didn't ask for this, ignore this email: your password stays the same.",
      secret: "To keep your account safe, don't forward this link to anyone.",
    },
    passwordChanged: {
      subject: 'Your AIVORE password was changed',
      preheader: 'The password of your account was just changed.',
      heading: 'Your password was changed',
      intro:
        'The password of your account ({email}) was changed on {time}, and you were signed out of every device.',
      warning:
        "If this wasn't you, reset your password right away: someone else may have access to your account.",
      action: 'Reset my password',
    },
    welcome: {
      subject: 'Welcome to AIVORE',
      preheader: 'Your account is ready.',
      heading: 'Welcome to AIVORE',
      intro: 'Your account is ready. Turn your ideas into images and videos, in Arabic or English.',
      bonus:
        'We added your sign-up bonus of {credits} to your balance so you can start right away.',
      action: 'Open the studio',
    },
    accountDeleted: {
      subject: 'Your AIVORE account was deleted',
      preheader: 'We deleted your account and everything you created.',
      heading: 'Your account was deleted',
      intro:
        'As you asked, we deleted your account ({email}) together with every image and video you created.',
      records:
        'We only keep the balance and payment records that accounting requires. They are no longer linked to your name or email.',
      warning: "If you didn't ask for this, please contact us as soon as possible.",
    },
  },
  ar: {
    brand: 'AIVORE',
    shared: {
      linkHint: 'إن لم يعمل الزر، انسخ هذا الرابط والصقه في المتصفح:',
      sentTo: 'أُرسلت هذه الرسالة إلى {email} لوجود نشاط على حسابك في AIVORE.',
      greeting: 'مرحبًا {name}،',
    },
    verification: {
      subject: 'أكّد بريدك الإلكتروني في AIVORE',
      preheader: 'خطوة واحدة وتبدأ الإبداع.',
      heading: 'أكّد بريدك الإلكتروني',
      intro: 'شكرًا لتسجيلك في AIVORE. أكّد أن {email} هو بريدك الإلكتروني لتفعيل حسابك.',
      bonus: 'بعد التأكيد يُضاف {credits} مجانًا إلى رصيدك.',
      action: 'تأكيد البريد',
      expiry: 'الرابط صالح لمدة {duration} ويُستخدم مرة واحدة فقط.',
      ignore: 'إن لم تنشئ حسابًا في AIVORE فتجاهل هذه الرسالة.',
    },
    passwordReset: {
      subject: 'إعادة تعيين كلمة المرور في AIVORE',
      preheader: 'تلقّينا طلبًا لإعادة تعيين كلمة مرورك.',
      heading: 'إعادة تعيين كلمة المرور',
      intro:
        'تلقّينا طلبًا لإعادة تعيين كلمة المرور لحسابك ({email}). اضغط الزر أدناه لاختيار كلمة مرور جديدة.',
      action: 'اختيار كلمة مرور جديدة',
      expiry: 'الرابط صالح لمدة {duration} ويُستخدم مرة واحدة فقط.',
      ignore: 'إن لم تطلب ذلك فتجاهل هذه الرسالة؛ ستبقى كلمة مرورك كما هي.',
      secret: 'لحماية حسابك، لا تشارك هذا الرابط مع أي شخص.',
    },
    passwordChanged: {
      subject: 'تم تغيير كلمة المرور في AIVORE',
      preheader: 'تم تغيير كلمة مرور حسابك للتو.',
      heading: 'تم تغيير كلمة المرور',
      intro: 'تم تغيير كلمة المرور لحسابك ({email}) في {time}، وسُجّل خروجك من جميع الأجهزة.',
      warning:
        'إن لم تكن أنت من فعل ذلك، فأعد تعيين كلمة المرور فورًا؛ فقد يكون شخص آخر قد وصل إلى حسابك.',
      action: 'إعادة تعيين كلمة المرور',
    },
    welcome: {
      subject: 'مرحبًا بك في AIVORE',
      preheader: 'حسابك جاهز.',
      heading: 'مرحبًا بك في AIVORE',
      intro: 'حسابك جاهز. حوّل أفكارك إلى صور وفيديوهات، بالعربية أو الإنجليزية.',
      bonus: 'أضفنا {credits} مجانًا إلى رصيدك لتبدأ فورًا.',
      action: 'افتح الاستوديو',
    },
    accountDeleted: {
      subject: 'تم حذف حسابك في AIVORE',
      preheader: 'حذفنا حسابك وكل ما أنشأته.',
      heading: 'تم حذف حسابك',
      intro: 'بناءً على طلبك، حذفنا حسابك ({email}) مع كل ما أنشأته من صور وفيديوهات.',
      records:
        'نحتفظ فقط بسجلات الرصيد والمدفوعات التي تتطلبها المحاسبة، ولم تعد مرتبطة باسمك أو بريدك.',
      warning: 'إن لم تطلب حذف حسابك، فتواصل معنا في أقرب وقت.',
    },
  },
});

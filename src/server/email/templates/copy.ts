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
      keysRevoked:
        'Your API keys were revoked as well. If you use the API, create new keys in your account.',
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
      preheader: 'We deleted your account and are erasing everything you created.',
      heading: 'Your account was deleted',
      intro:
        'As you asked, we deleted your account ({email}) and signed you out everywhere. The images and videos you created are being erased now; if anything cannot be removed right away, we keep trying until it is gone.',
      records:
        'We only keep the balance and payment records that accounting requires. They are no longer linked to your name or email.',
      warning: "If you didn't ask for this, please contact us as soon as possible.",
    },
    billing: {
      support: 'Questions about a payment? Write to {email}.',
      notInvoice: 'This message confirms your payment. It is not a tax invoice.',
      noCharge: 'We never charge your card automatically.',
      kept: 'Credits you already have stay in your balance and never expire.',
      openBilling: 'Open billing',
      planLabel: '{name} plan',
      receipt: {
        subject: 'Payment received: {item}',
        preheader: 'Your credits are in your account.',
        heading: 'Payment received',
        intro:
          'Thank you. We received your payment for {item} and added the credits to your balance.',
        introRenewal:
          'Thank you. We received the monthly payment for your {item} and added the credits for this month to your balance.',
        renewalNote:
          'Your plan renews every month. We email you the payment link {lead} before the month ends.',
        noPlan:
          'This payment did not start a new month of your plan, because the plan had already ended. The credits are in your balance, and you can subscribe again whenever you like.',
        labels: {
          amount: 'Amount paid (VAT included)',
          vat: 'Of which VAT',
          credits: 'Credits added',
          reference: 'Order reference',
          date: 'Date',
          paidUntil: 'Plan paid until',
        },
      },
      renewalLink: {
        subject: 'Your {item} renewal is ready to pay',
        preheader: 'Pay by {date} to keep your plan running.',
        heading: 'Time to renew your plan',
        intro:
          'Your {item} renews on {date}. The payment for the next month, {amount} with VAT included, for {credits}, is ready.',
        unpaid:
          'If it is not paid by then, your plan becomes overdue. You can still pay until {graceEnd}; after that the plan expires and no more monthly credits are added.',
        cancel: 'Do not want to renew? Cancel the plan in Billing and ignore this message.',
        billingHint: 'You can also pay from your Billing page: {billing}',
        action: 'Pay now',
      },
      overdue: {
        subject: 'Payment overdue: your {item}',
        preheader: 'Pay by {graceEnd} to keep your plan.',
        heading: 'Your plan payment is overdue',
        intro:
          'The month of your {item} ended on {date} and the renewal payment of {amount} has not been paid yet.',
        deadline:
          'You can still pay until {graceEnd}. After that the plan expires and no more monthly credits are added.',
        action: 'Pay now',
      },
      expired: {
        subject: 'Your {item} has ended',
        preheader: 'The renewal was not paid in time.',
        heading: 'Your plan has ended',
        intro:
          'We did not receive the renewal payment for your {item} in time, so the plan expired and no more monthly credits will be added.',
        again: 'You can subscribe again whenever you like.',
        action: 'See plans',
      },
      refund: {
        subject: 'Refund for {item}',
        preheader: 'Part or all of a payment was returned.',
        heading: 'A payment was returned',
        intro:
          '{amount} of your payment for {item} (order {reference}) was returned to you. How soon it shows on your statement depends on your bank.',
        introNoCredit:
          'Your payment of {amount} for {item} (order {reference}) was returned to you before any credits were added, so nothing was added to your balance.',
        credits: '{credits} were taken back from your balance.',
        total: 'Returned so far: {total} of {price}.',
        planEnded: 'The plan that this payment covered has ended.',
      },
      canceled: {
        subject: 'Your {item} is canceled',
        preheader: 'It stays active until the month you paid for ends.',
        heading: 'Plan canceled',
        introEnd:
          'Your {item} is canceled and ends on {date}. It stays fully active until then, and we will not send a renewal link.',
        introNow:
          'Your {item} was overdue, so canceling ended it right away. We will not send a renewal link.',
        resume: 'Changed your mind? You can resume the plan in Billing until {date}.',
      },
      resumed: {
        subject: 'Your {item} continues',
        preheader: 'It will renew as usual.',
        heading: 'Plan resumed',
        intro: 'Your {item} will renew as usual on {date}.',
        link: 'We email you the payment link {lead} before the month ends.',
      },
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
      keysRevoked:
        'كما أُلغيت مفاتيح API الخاصة بك. إن كنت تستخدم واجهة API فأنشئ مفاتيح جديدة من حسابك.',
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
      preheader: 'حذفنا حسابك ونمحو الآن كل ما أنشأته.',
      heading: 'تم حذف حسابك',
      intro:
        'بناءً على طلبك، حذفنا حسابك ({email}) وسجّلنا خروجك من كل مكان. تجري الآن إزالة الصور والفيديوهات التي أنشأتها، وإن تعذّر حذف شيء منها فورًا فسنواصل المحاولة حتى يُحذف بالكامل.',
      records:
        'نحتفظ فقط بسجلات الرصيد والمدفوعات التي تتطلبها المحاسبة، ولم تعد مرتبطة باسمك أو بريدك.',
      warning: 'إن لم تطلب حذف حسابك، فتواصل معنا في أقرب وقت.',
    },
    billing: {
      support: 'لديك سؤال عن دفعة؟ راسلنا على {email}.',
      notInvoice: 'هذه الرسالة تأكيد لدفعتك وليست فاتورة ضريبية.',
      noCharge: 'لا نخصم من بطاقتك تلقائيًا أبدًا.',
      kept: 'الأرصدة التي لديك تبقى في رصيدك ولا تنتهي صلاحيتها.',
      openBilling: 'افتح صفحة الفوترة',
      planLabel: 'باقة {name}',
      receipt: {
        subject: 'تم استلام دفعتك: {item}',
        preheader: 'أُضيفت الأرصدة إلى حسابك.',
        heading: 'تم استلام الدفعة',
        intro: 'شكرًا لك. استلمنا دفعتك مقابل {item} وأضفنا الأرصدة إلى رصيدك.',
        introRenewal: 'شكرًا لك. استلمنا دفعة هذا الشهر مقابل {item} وأضفنا أرصدة الشهر إلى رصيدك.',
        renewalNote: 'تتجدد باقتك كل شهر. نرسل لك رابط الدفع قبل {lead} من نهاية الشهر.',
        noPlan:
          'لم تبدأ هذه الدفعة شهرًا جديدًا من باقتك لأن الباقة كانت قد انتهت. الأرصدة في رصيدك، ويمكنك الاشتراك من جديد في أي وقت.',
        labels: {
          amount: 'المبلغ المدفوع (شامل الضريبة)',
          vat: 'منه ضريبة القيمة المضافة',
          credits: 'الأرصدة المضافة',
          reference: 'رقم الطلب',
          date: 'التاريخ',
          paidUntil: 'الباقة مدفوعة حتى',
        },
      },
      renewalLink: {
        subject: 'تجديد {item} جاهز للدفع',
        preheader: 'ادفع قبل {date} لتستمر باقتك.',
        heading: 'حان وقت تجديد باقتك',
        intro:
          'تتجدد {item} في {date}. دفعة الشهر القادم جاهزة: {amount} شاملة الضريبة مقابل {credits}.',
        unpaid:
          'إن لم تُدفع حتى ذلك الوقت تصبح الباقة متأخرة الدفع. ويمكنك الدفع بعدها حتى {graceEnd}، وبعد ذلك تنتهي الباقة ولا تُضاف أرصدة شهرية جديدة.',
        cancel: 'لا تريد التجديد؟ ألغِ الباقة من صفحة الفوترة وتجاهل هذه الرسالة.',
        billingHint: 'يمكنك أيضًا الدفع من صفحة الفوترة: {billing}',
        action: 'ادفع الآن',
      },
      overdue: {
        subject: 'دفعة {item} متأخرة',
        preheader: 'ادفع قبل {graceEnd} لتحتفظ بباقتك.',
        heading: 'دفعة باقتك متأخرة',
        intro: 'انتهى شهر {item} في {date} ولم تصلنا دفعة التجديد ({amount}) بعد.',
        deadline:
          'ما زال بإمكانك الدفع حتى {graceEnd}. بعد ذلك تنتهي الباقة ولا تُضاف أرصدة شهرية جديدة.',
        action: 'ادفع الآن',
      },
      expired: {
        subject: 'انتهت {item}',
        preheader: 'لم تُدفع دفعة التجديد في موعدها.',
        heading: 'انتهت باقتك',
        intro:
          'لم تصلنا دفعة تجديد {item} في موعدها، لذلك انتهت الباقة ولن تُضاف أرصدة شهرية جديدة.',
        again: 'يمكنك الاشتراك من جديد في أي وقت.',
        action: 'عرض الباقات',
      },
      refund: {
        subject: 'استرداد مبلغ {item}',
        preheader: 'رُدّ جزء من دفعتك أو كلها.',
        heading: 'رُدّ مبلغ من دفعتك',
        intro:
          'رُدّ إليك {amount} من دفعتك مقابل {item} (الطلب {reference}). يعتمد موعد ظهور المبلغ في كشف حسابك على بنكك.',
        introNoCredit:
          'رُدّت إليك دفعتك البالغة {amount} مقابل {item} (الطلب {reference}) قبل إضافة أي أرصدة، لذلك لم يُضف شيء إلى رصيدك.',
        credits: 'خصمنا {credits} من رصيدك.',
        // The amount ends the sentence and "ر.س." already ends in a full stop: a second one would double it.
        total: 'المبلغ المردود حتى الآن {total} من أصل {price}',
        planEnded: 'انتهت الباقة التي كانت هذه الدفعة تغطيها.',
      },
      canceled: {
        subject: 'تم إلغاء {item}',
        preheader: 'تبقى فعّالة حتى نهاية الشهر المدفوع.',
        heading: 'تم إلغاء الباقة',
        introEnd:
          'ألغينا {item} وستنتهي في {date}. تبقى فعّالة بالكامل حتى ذلك الوقت ولن نرسل رابط تجديد.',
        introNow: 'كانت {item} متأخرة الدفع، لذلك أنهاها الإلغاء فورًا. لن نرسل رابط تجديد.',
        resume: 'غيّرت رأيك؟ يمكنك استئناف الباقة من صفحة الفوترة حتى {date}.',
      },
      resumed: {
        subject: 'تستمر {item}',
        preheader: 'ستتجدد كالمعتاد.',
        heading: 'تم استئناف الباقة',
        intro: 'ستتجدد {item} كالمعتاد في {date}.',
        link: 'نرسل لك رابط الدفع قبل {lead} من نهاية الشهر.',
      },
    },
  },
});

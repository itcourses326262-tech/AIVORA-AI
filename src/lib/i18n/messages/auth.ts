import { defineMessages } from '@/lib/i18n/define';

export default defineMessages({
  en: {
    login: {
      title: 'Welcome back',
      subtitle: 'Log in to keep creating.',
      submit: 'Log in',
      submitting: 'Logging in…',
      noAccount: 'New to AIVORE?',
      createAccount: 'Create an account',
      forgot: 'Forgot password?',
    },
    register: {
      title: 'Create your account',
      subtitle: 'Start with free credits. No card needed.',
      submit: 'Create account',
      submitting: 'Creating your account…',
      haveAccount: 'Already have an account?',
      logIn: 'Log in',
      benefitsLabel: 'What you get',
      benefits: {
        credits: '{credits} free to start',
        languages: 'Prompts in Arabic or English',
        studio: 'Images and video in one studio',
      },
      closed: 'Sign-ups are closed for now.',
    },
    panel: {
      title: 'Everything you imagine, ready in seconds',
      enhancer: 'A prompt enhancer that speaks Arabic',
      sampleLabel: 'Sample artwork',
    },
    fields: {
      name: 'Name',
      email: 'Email',
      password: 'Password',
      namePlaceholder: 'Your name',
      emailPlaceholder: 'you@example.com',
    },
    hints: {
      password: 'At least 8 characters.',
    },
    validation: {
      nameRequired: 'Enter your name.',
      nameTooLong: 'Use {max} characters or fewer.',
      emailRequired: 'Enter your email address.',
      emailInvalid: 'Enter a valid email address, like you@example.com.',
      passwordRequired: 'Enter your password.',
      passwordTooShort: 'Use at least {min} characters.',
      passwordTooLong: 'Use {max} characters or fewer.',
    },
    errors: {
      invalidCredentials: 'Incorrect email or password.',
      emailTaken: 'An account with this email already exists.',
      rateLimitedIn: 'Too many attempts. Try again in {time}.',
      passwordRejected: 'This password is too common or easy to guess. Try another one.',
    },
    google: {
      button: 'Continue with Google',
      busy: 'Waiting for Google…',
      divider: 'or',
      errors: {
        popupBlocked:
          'Your browser blocked the Google window. Allow pop-ups for this site, then try again.',
        failed: 'We could not sign you in with Google. Please try again.',
        verifyFailed: 'We could not verify your Google sign-in. Please try again.',
        disabled: 'This account is disabled. Contact support if you think this is a mistake.',
        notConfigured:
          'Google sign-in is not set up for this site yet. Please use your email and password for now.',
        inAppBrowser:
          "Google sign-in does not work inside this app's browser. Open this page in your browser (Chrome or Safari) and try again.",
      },
      inApp: {
        note: 'Opened this page inside another app? Google may not let you sign in here. Open it in your browser (Chrome or Safari) to continue with Google.',
        copy: 'Copy link',
        copied: 'Link copied. Paste it into your browser.',
        copyFailed: 'Could not copy. Select the link and copy it by hand:',
        linkLabel: 'Page link',
      },
    },
    setPassword: {
      changeNote:
        'Your account signs in with Google and has no password yet. If you also want to log in with your email and a password, we can email you a link to set one.',
      deleteNote:
        'Your account signs in with Google, so there is no password to confirm with. Set a password first: we will email you a link. Then come back here to delete your account.',
      button: 'Email me a link to set a password',
      sending: 'Sending…',
      sent: 'We sent a link to {email}. Open it to choose a password; it works for one hour.',
    },
    strength: {
      label: 'Password strength',
      weak: 'Weak',
      fair: 'Fair',
      good: 'Good',
      strong: 'Strong',
    },
    password: {
      show: 'Show password',
      hide: 'Hide password',
    },
    guard: {
      redirecting: 'Taking you to the log in page…',
    },
    layout: {
      backToHome: 'Back to home',
    },
    forgot: {
      title: 'Forgot your password?',
      subtitle:
        'Enter the email you signed up with and we will send you a link to choose a new password.',
      submit: 'Send reset link',
      submitting: 'Sending…',
      backToLogin: 'Back to log in',
      sentTitle: 'Check your email',
      sentBody:
        'If there is an account for {email}, a link to reset its password is on its way. It works for one hour.',
      sentHint: 'Nothing yet? Look in your spam folder, or try again in a few minutes.',
      useAnother: 'Use a different email',
    },
    reset: {
      title: 'Choose a new password',
      subtitle:
        'Pick one you do not use anywhere else. All your devices will be signed out and your API keys revoked.',
      newPassword: 'New password',
      submit: 'Save new password',
      submitting: 'Saving…',
      successTitle: 'Password updated',
      successBody:
        'You are signed out everywhere and your API keys were revoked. Log in with your new password.',
      logIn: 'Log in',
      requestNew: 'Request a new link',
      problem: {
        invalid: {
          title: 'This link does not work',
          body: 'The link is incomplete or not valid. Request a new one and use the link in the newest email.',
        },
        expired: {
          title: 'This link has expired',
          body: 'Reset links work for one hour. Request a new one.',
        },
        used: {
          title: 'This link was already used',
          body: 'For your safety each link works once. Request a new one if you still need to reset your password.',
        },
      },
    },
    verify: {
      confirming: 'Confirming your email…',
      successTitle: 'Email confirmed',
      successBody: 'Thank you. Your account is fully active.',
      alreadyBody: 'This address was already confirmed. You are all set.',
      bonus: '{credits} were added to your balance.',
      openStudio: 'Open the studio',
      logIn: 'Log in',
      resend: 'Send me a new link',
      resendSent: 'A new link is on its way. Check your inbox.',
      loginToRequest: 'Log in to request a new link.',
      networkTitle: 'Could not confirm yet',
      networkBody: 'We could not reach the server. Check your connection and try again.',
      retry: 'Try again',
      problem: {
        invalid: {
          title: 'This link does not work',
          body: 'The link is incomplete or not valid. Use the link in the newest email we sent you.',
        },
        expired: {
          title: 'This link has expired',
          body: 'Confirmation links stop working after a while. Request a new one.',
        },
        used: {
          title: 'This link was already used',
          body: 'If you already confirmed your email you are all set. Otherwise request a new link.',
        },
      },
    },
    banner: {
      label: 'Email confirmation',
      message:
        'Confirm {email} to start creating. Until then you can look around, but you cannot generate.',
      messageBonus: 'Confirm {email} to claim your sign-up bonus of {credits} and start creating.',
      resend: 'Resend link',
      resendIn: 'Resend in {time}',
      sent: 'Confirmation email sent. Check your inbox.',
    },
    dataRights: {
      export: {
        title: 'Download your data',
        description:
          'A JSON file with your profile, credit history, purchases, generations and file links. You can download it up to three times a day.',
        button: 'Download my data',
        preparing: 'Preparing…',
        failed: 'We could not prepare the download.',
      },
      delete: {
        title: 'Delete account',
        description:
          'Permanently removes your account, generations and files. Credit and payment records are kept for accounting, without your name or email. This cannot be undone.',
        button: 'Delete my account…',
        confirmTitle: 'Delete your account?',
        confirmBody:
          'Everything you created will be removed, your remaining balance ({credits}) will be lost and any subscription will be canceled. This cannot be undone.',
        passwordLabel: 'Enter your password to confirm',
        submit: 'Delete forever',
        submitting: 'Deleting…',
        cancel: 'Keep my account',
        wrongPassword: 'That password is not correct.',
        billingError:
          'We could not cancel your subscription right now, so nothing was deleted. Please try again in a moment.',
      },
    },
  },
  ar: {
    login: {
      title: 'مرحبًا بعودتك',
      subtitle: 'سجّل الدخول لتواصل الإبداع.',
      submit: 'تسجيل الدخول',
      submitting: 'جارٍ تسجيل الدخول…',
      noAccount: 'جديد في AIVORE؟',
      createAccount: 'أنشئ حسابًا',
      forgot: 'نسيت كلمة المرور؟',
    },
    register: {
      title: 'أنشئ حسابك',
      subtitle: 'ابدأ برصيد مجاني. لا حاجة لبطاقة.',
      submit: 'إنشاء الحساب',
      submitting: 'جارٍ إنشاء حسابك…',
      haveAccount: 'لديك حساب بالفعل؟',
      logIn: 'تسجيل الدخول',
      benefitsLabel: 'ما ستحصل عليه',
      benefits: {
        credits: '{credits} مجانًا للبدء',
        languages: 'وصف بالعربية أو الإنجليزية',
        studio: 'صور وفيديوهات في استوديو واحد',
      },
      closed: 'التسجيل مغلق في الوقت الحالي.',
    },
    panel: {
      title: 'كل ما تتخيله، جاهز خلال ثوانٍ',
      enhancer: 'محسّن وصف يفهم العربية',
      sampleLabel: 'عمل فني توضيحي',
    },
    fields: {
      name: 'الاسم',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      namePlaceholder: 'اسمك',
      emailPlaceholder: 'name@example.com',
    },
    hints: {
      password: '٨ أحرف على الأقل.',
    },
    validation: {
      nameRequired: 'أدخل اسمك.',
      nameTooLong: 'استخدم {max} حرفًا أو أقل.',
      emailRequired: 'أدخل بريدك الإلكتروني.',
      emailInvalid: 'أدخل بريدًا إلكترونيًا صالحًا، مثل name@example.com.',
      passwordRequired: 'أدخل كلمة المرور.',
      passwordTooShort: 'استخدم {min} أحرف على الأقل.',
      passwordTooLong: 'استخدم {max} حرفًا أو أقل.',
    },
    errors: {
      invalidCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      emailTaken: 'يوجد حساب مسجّل بهذا البريد الإلكتروني بالفعل.',
      rateLimitedIn: 'محاولات كثيرة. حاول مرة أخرى بعد {time}.',
      passwordRejected: 'كلمة المرور هذه شائعة أو سهلة التخمين. جرّب كلمة أخرى.',
    },
    google: {
      button: 'المتابعة باستخدام Google',
      busy: 'في انتظار Google…',
      divider: 'أو',
      errors: {
        popupBlocked:
          'منع المتصفح نافذة Google. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.',
        failed: 'تعذّر تسجيل دخولك عبر Google. حاول مرة أخرى.',
        verifyFailed: 'تعذّر التحقق من تسجيل الدخول عبر Google. حاول مرة أخرى.',
        disabled: 'هذا الحساب معطّل. تواصل مع الدعم إن كنت ترى أن ذلك خطأ.',
        notConfigured:
          'تسجيل الدخول عبر Google غير مُعدّ لهذا الموقع بعد. استخدم بريدك الإلكتروني وكلمة المرور في الوقت الحالي.',
        inAppBrowser:
          'لا يعمل تسجيل الدخول عبر Google داخل متصفح هذا التطبيق. افتح هذه الصفحة في متصفحك (Chrome أو Safari) ثم حاول مرة أخرى.',
      },
      inApp: {
        note: 'فتحت هذه الصفحة داخل تطبيق آخر؟ قد لا تسمح Google بتسجيل الدخول هنا. افتحها في متصفحك (Chrome أو Safari) لتتابع عبر Google.',
        copy: 'نسخ الرابط',
        copied: 'تم نسخ الرابط. الصقه في متصفحك.',
        copyFailed: 'تعذّر النسخ. حدّد الرابط وانسخه يدويًا:',
        linkLabel: 'رابط الصفحة',
      },
    },
    setPassword: {
      changeNote:
        'يسجّل حسابك الدخول عبر Google وليست له كلمة مرور بعد. إن أردت الدخول أيضًا بالبريد الإلكتروني وكلمة المرور، فسنرسل إليك رابطًا لتعيين واحدة.',
      deleteNote:
        'يسجّل حسابك الدخول عبر Google، فلا توجد كلمة مرور للتأكيد بها. عيّن كلمة مرور أولًا: سنرسل إليك رابطًا. ثم عُد إلى هنا لحذف حسابك.',
      button: 'أرسل لي رابطًا لتعيين كلمة مرور',
      sending: 'جارٍ الإرسال…',
      sent: 'أرسلنا رابطًا إلى {email}. افتحه لاختيار كلمة مرور، وهو صالح لمدة ساعة.',
    },
    strength: {
      label: 'قوة كلمة المرور',
      weak: 'ضعيفة',
      fair: 'مقبولة',
      good: 'جيدة',
      strong: 'قوية',
    },
    password: {
      show: 'إظهار كلمة المرور',
      hide: 'إخفاء كلمة المرور',
    },
    guard: {
      redirecting: 'جارٍ نقلك إلى صفحة تسجيل الدخول…',
    },
    layout: {
      backToHome: 'العودة إلى الرئيسية',
    },
    forgot: {
      title: 'نسيت كلمة المرور؟',
      subtitle: 'أدخل البريد الإلكتروني الذي سجّلت به وسنرسل لك رابطًا لاختيار كلمة مرور جديدة.',
      submit: 'إرسال رابط إعادة التعيين',
      submitting: 'جارٍ الإرسال…',
      backToLogin: 'العودة إلى تسجيل الدخول',
      sentTitle: 'تحقق من بريدك',
      sentBody:
        'إن كان هناك حساب مرتبط بالبريد {email}، فقد أُرسل إليه رابط لإعادة تعيين كلمة المرور، وهو صالح لمدة ساعة.',
      sentHint: 'لم يصلك شيء؟ تحقق من مجلد الرسائل غير المرغوب فيها، أو حاول مجددًا بعد دقائق.',
      useAnother: 'استخدام بريد آخر',
    },
    reset: {
      title: 'اختر كلمة مرور جديدة',
      subtitle:
        'اختر كلمة مرور لا تستخدمها في أي مكان آخر. سيتم تسجيل خروجك من جميع الأجهزة وإلغاء مفاتيح API الخاصة بك.',
      newPassword: 'كلمة المرور الجديدة',
      submit: 'حفظ كلمة المرور',
      submitting: 'جارٍ الحفظ…',
      successTitle: 'تم تحديث كلمة المرور',
      successBody:
        'سُجّل خروجك من جميع الأجهزة وأُلغيت مفاتيح API الخاصة بك. سجّل الدخول بكلمة مرورك الجديدة.',
      logIn: 'تسجيل الدخول',
      requestNew: 'اطلب رابطًا جديدًا',
      problem: {
        invalid: {
          title: 'هذا الرابط لا يعمل',
          body: 'الرابط غير مكتمل أو غير صالح. اطلب رابطًا جديدًا واستخدم الرابط الموجود في أحدث رسالة.',
        },
        expired: {
          title: 'انتهت صلاحية هذا الرابط',
          body: 'روابط إعادة التعيين صالحة لمدة ساعة واحدة. اطلب رابطًا جديدًا.',
        },
        used: {
          title: 'استُخدم هذا الرابط من قبل',
          body: 'لحمايتك، يعمل كل رابط مرة واحدة فقط. اطلب رابطًا جديدًا إن كنت لا تزال بحاجة إلى إعادة تعيين كلمة المرور.',
        },
      },
    },
    verify: {
      confirming: 'جارٍ تأكيد بريدك الإلكتروني…',
      successTitle: 'تم تأكيد البريد الإلكتروني',
      successBody: 'شكرًا لك. حسابك مفعّل بالكامل.',
      alreadyBody: 'تم تأكيد هذا البريد من قبل. كل شيء جاهز.',
      bonus: 'أُضيف {credits} إلى رصيدك.',
      openStudio: 'افتح الاستوديو',
      logIn: 'تسجيل الدخول',
      resend: 'أرسل لي رابطًا جديدًا',
      resendSent: 'تم إرسال رابط جديد. تحقق من بريدك.',
      loginToRequest: 'سجّل الدخول لطلب رابط جديد.',
      networkTitle: 'تعذّر التأكيد حتى الآن',
      networkBody: 'تعذّر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.',
      retry: 'حاول مرة أخرى',
      problem: {
        invalid: {
          title: 'هذا الرابط لا يعمل',
          body: 'الرابط غير مكتمل أو غير صالح. استخدم الرابط الموجود في أحدث رسالة أرسلناها إليك.',
        },
        expired: {
          title: 'انتهت صلاحية هذا الرابط',
          body: 'تنتهي صلاحية روابط التأكيد بعد مدة. اطلب رابطًا جديدًا.',
        },
        used: {
          title: 'استُخدم هذا الرابط من قبل',
          body: 'إن كنت قد أكّدت بريدك فكل شيء جاهز، وإلا فاطلب رابطًا جديدًا.',
        },
      },
    },
    banner: {
      label: 'تأكيد البريد الإلكتروني',
      message:
        'أكّد بريدك {email} لتبدأ الإنشاء. يمكنك التصفح حتى ذلك الحين، لكن لا يمكنك التوليد.',
      messageBonus: 'أكّد بريدك {email} لتحصل على {credits} مجانًا وتبدأ الإنشاء.',
      resend: 'إعادة إرسال الرابط',
      resendIn: 'إعادة الإرسال بعد {time}',
      sent: 'تم إرسال رسالة التأكيد. تحقق من بريدك.',
    },
    dataRights: {
      export: {
        title: 'نزّل بياناتك',
        description:
          'ملف JSON يضم ملفك الشخصي وسجل الرصيد ومشترياتك وعمليات التوليد وروابط ملفاتك. يمكنك تنزيله حتى ثلاث مرات يوميًا.',
        button: 'تنزيل بياناتي',
        preparing: 'جارٍ التجهيز…',
        failed: 'تعذّر تجهيز التنزيل.',
      },
      delete: {
        title: 'حذف الحساب',
        description:
          'يحذف حسابك وعمليات التوليد والملفات نهائيًا. تبقى سجلات الرصيد والمدفوعات للمحاسبة دون اسمك أو بريدك. لا يمكن التراجع عن ذلك.',
        button: 'حذف حسابي…',
        confirmTitle: 'هل تريد حذف حسابك؟',
        confirmBody:
          'سيُحذف كل ما أنشأته، وسيضيع رصيدك المتبقي ({credits})، وسيُلغى أي اشتراك. لا يمكن التراجع عن ذلك.',
        passwordLabel: 'أدخل كلمة المرور للتأكيد',
        submit: 'حذف نهائيًا',
        submitting: 'جارٍ الحذف…',
        cancel: 'الإبقاء على حسابي',
        wrongPassword: 'كلمة المرور غير صحيحة.',
        billingError: 'تعذّر إلغاء اشتراكك الآن، لذلك لم يُحذف شيء. حاول مرة أخرى بعد قليل.',
      },
    },
  },
});

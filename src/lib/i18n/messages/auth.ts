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
  },
  ar: {
    login: {
      title: 'مرحبًا بعودتك',
      subtitle: 'سجّل الدخول لتواصل الإبداع.',
      submit: 'تسجيل الدخول',
      submitting: 'جارٍ تسجيل الدخول…',
      noAccount: 'جديد في AIVORE؟',
      createAccount: 'أنشئ حسابًا',
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
  },
});

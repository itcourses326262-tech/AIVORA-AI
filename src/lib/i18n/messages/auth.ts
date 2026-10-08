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
    errors: {
      invalidCredentials: 'Incorrect email or password.',
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
    },
    fields: {
      name: 'الاسم',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      namePlaceholder: 'اسمك',
      emailPlaceholder: 'you@example.com',
    },
    hints: {
      password: '٨ أحرف على الأقل.',
    },
    errors: {
      invalidCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
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

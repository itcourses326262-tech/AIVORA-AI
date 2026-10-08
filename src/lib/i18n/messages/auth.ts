import { defineMessages } from '@/lib/i18n/define';

export default defineMessages({
  en: {
    login: {
      title: 'Welcome back',
      submit: 'Log in',
    },
    register: {
      title: 'Create your account',
      submit: 'Create account',
    },
    fields: {
      name: 'Name',
      email: 'Email',
      password: 'Password',
    },
  },
  ar: {
    login: {
      title: 'مرحبًا بعودتك',
      submit: 'تسجيل الدخول',
    },
    register: {
      title: 'أنشئ حسابك',
      submit: 'إنشاء الحساب',
    },
    fields: {
      name: 'الاسم',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
    },
  },
});

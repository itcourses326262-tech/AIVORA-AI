'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState, type FocusEvent, type ReactNode, type Ref } from 'react';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/client';

export interface PasswordFieldProps {
  name?: string;
  /** A fixed id (`password`) for pages with one password field, so a password manager knows the form again. */
  id?: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  error?: string;
  /** Under the control and part of its accessible description (a hint, a strength meter). */
  hint?: ReactNode;
  autoComplete: 'current-password' | 'new-password';
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * A password input with a show/hide button. The button keeps one stable role, a button whose name
 * says what a press does ("Show password" / "Hide password"), and points at the input it controls.
 * Passwords are typed left to right whatever the page language, so the input is `dir="ltr"`
 * (and sits against the end of the box in right-to-left pages, like the other fields).
 */
export function PasswordField({
  name = 'password',
  id: fixedId,
  label,
  value,
  onValueChange,
  onBlur,
  error,
  hint,
  autoComplete,
  inputRef,
}: PasswordFieldProps) {
  const { t } = useI18n();
  const generatedId = `password-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const id = fixedId ?? generatedId;
  const [visible, setVisible] = useState(false);
  return (
    <Field id={id} label={label} error={error} hint={hint} required>
      <Input
        ref={inputRef}
        name={name}
        type={visible ? 'text' : 'password'}
        dir="ltr"
        className="rtl:text-end"
        size="lg"
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={onBlur}
        endAdornment={
          <IconButton
            size="sm"
            label={visible ? t('auth.password.hide') : t('auth.password.show')}
            tooltip={false}
            aria-controls={id}
            className="-me-1.5 text-muted"
            // Pressing the button must not take focus (and the keyboard) away from the input.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? <EyeOff /> : <Eye />}
          </IconButton>
        }
      />
    </Field>
  );
}

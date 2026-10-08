'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { Button, type ButtonProps } from '../ui/button';
import { toast } from '../ui/toast';

export interface CopyButtonProps {
  /** What goes to the clipboard. */
  text: string;
  /** The button's text, e.g. "Copy prompt". */
  label: string;
  /** Shown for a moment after copying, e.g. "Copied". Defaults to the shared "Copied". */
  copiedLabel?: string;
  /** What a failed copy (blocked clipboard) tells the person. */
  failedMessage: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const CONFIRMATION_MS = 2000;

/** Copies `text` and says so on the button itself and to screen readers; a refusal gets a toast. */
export function CopyButton({
  text,
  label,
  copiedLabel,
  failedMessage,
  variant = 'secondary',
  size = 'md',
  className,
}: CopyButtonProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const done = copiedLabel ?? t('common.actions.copied');
  const onClick: ButtonProps['onClick'] = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast.warning(failedMessage);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        startIcon={copied ? <Check className="text-success" /> : <Copy />}
        onClick={onClick}
      >
        {copied ? done : label}
      </Button>
      <span role="status" className="sr-only">
        {copied ? done : ''}
      </span>
    </>
  );
}

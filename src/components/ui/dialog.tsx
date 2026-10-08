'use client';

import { cn } from '@/lib/utils';
import { Modal, type ModalCommonProps } from './modal';

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
  xl: 'max-w-3xl',
} as const;

export interface DialogProps extends ModalCommonProps {
  size?: keyof typeof SIZES;
  /**
   * `alertdialog` is for confirmations that interrupt the user (delete, discard): it announces
   * itself assertively and should not be dismissible by a stray click.
   */
  role?: 'dialog' | 'alertdialog';
}

/**
 * A modal dialog: focus moves inside and is trapped, the page behind is inert and cannot scroll,
 * Escape and the backdrop close it (unless `dismissible={false}`), and focus returns to where it was.
 */
export function Dialog({ size = 'md', role = 'dialog', className, ...props }: DialogProps) {
  return (
    <Modal
      {...props}
      kind={role === 'alertdialog' ? 'alertdialog' : 'dialog'}
      className={cn('mx-auto', SIZES[size], className)}
    />
  );
}

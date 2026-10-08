'use client';

import { useRef } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

export interface BulkDeleteDialogProps {
  open: boolean;
  /** How many creations would go. */
  count: number;
  /** Some of them are still being made: they are canceled and refunded first. */
  includesRunning: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

/** The question behind "Delete" in multi-select mode. The safe button has the initial focus. */
export function BulkDeleteDialog({
  open,
  count,
  includesRunning,
  onConfirm,
  onDismiss,
}: BulkDeleteDialogProps) {
  const { t, plural } = useI18n();
  const safeRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      role="alertdialog"
      size="sm"
      showClose={false}
      initialFocusRef={safeRef}
      title={plural(count, {
        one: t('gallery.select.deleteTitle.one'),
        two: t('gallery.select.deleteTitle.two'),
        few: t('gallery.select.deleteTitle.few'),
        many: t('gallery.select.deleteTitle.many'),
        other: t('gallery.select.deleteTitle.other'),
      })}
      description={
        includesRunning
          ? t('gallery.select.deleteBodyRunning')
          : t('gallery.select.deleteBody')
      }
      footer={
        <>
          <Button ref={safeRef} variant="secondary" onClick={onDismiss}>
            {t('gallery.select.keep')}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t('gallery.select.deleteConfirm')}
          </Button>
        </>
      }
    />
  );
}

'use client';

/**
 * The question behind "Cancel" (while a generation is running) and "Delete". Render it once next to
 * the list and feed it the `confirmation` state of `useGenerationActions`.
 *
 * Props
 * - `confirmation`: what to ask about, or `null` for no dialog.
 * - `onConfirm`, `onDismiss`: the two answers. The safe button has the initial focus.
 */
import { useRef } from 'react';
import type { GenerationConfirmation } from '@/lib/generations/use-generation-actions';
import { isActive } from '@/lib/generations/media';
import { useI18n } from '@/lib/i18n/client';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';

export interface GenerationConfirmProps {
  confirmation: GenerationConfirmation | null;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function GenerationConfirm({ confirmation, onConfirm, onDismiss }: GenerationConfirmProps) {
  const { t } = useI18n();
  const safeRef = useRef<HTMLButtonElement>(null);
  const deleting = confirmation?.kind === 'delete';
  const running = confirmation ? isActive(confirmation.generation) : false;

  return (
    <Dialog
      open={confirmation !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
      role="alertdialog"
      size="sm"
      showClose={false}
      initialFocusRef={safeRef}
      title={deleting ? t('studio.generations.delete.title') : t('studio.generations.cancel.title')}
      description={
        deleting
          ? running
            ? t('studio.generations.delete.bodyActive')
            : t('studio.generations.delete.body')
          : t('studio.generations.cancel.body')
      }
      footer={
        <>
          <Button ref={safeRef} variant="secondary" onClick={onDismiss}>
            {deleting ? t('studio.generations.delete.keep') : t('studio.generations.cancel.keep')}
          </Button>
          <Button variant="danger" loading={confirmation?.busy} onClick={onConfirm}>
            {deleting
              ? t('studio.generations.delete.confirm')
              : t('studio.generations.cancel.confirm')}
          </Button>
        </>
      }
    />
  );
}

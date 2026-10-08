'use client';

import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { getTabbable, trapTab } from './focus';
import { IconButton } from './icon-button';
import { inertBackground, lockPageScroll } from './page-lock';
import { Portal } from './portal';
import { usePresence } from './use-presence';

const EXIT_MS = 160;

// The open modals, oldest first. Escape belongs to the one on top: a delete confirmation opened
// from a detail dialog must not close the dialog underneath. (Tab never needs the same rule: the
// modals below are `inert`, so focus and key events only ever reach the top one, and the scroll
// lock is reference counted.)
const openModals: string[] = [];
const isTopModal = (token: string) => openModals[openModals.length - 1] === token;

export interface ModalCommonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The accessible name of the modal. */
  title: ReactNode;
  description?: ReactNode;
  /** Keep the title for assistive technology only (navigation sheets). */
  hideTitle?: boolean;
  /** Escape and a click on the backdrop close the modal. Defaults to true. */
  dismissible?: boolean;
  /** Show the close button in the header. Defaults to true. */
  showClose?: boolean;
  /** Overrides the first-tabbable default for the initial focus. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Buttons row under the body. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

type ModalKind = 'dialog' | 'alertdialog' | 'sheet-start' | 'sheet-end' | 'sheet-bottom';

const PANEL: Record<ModalKind, string> = {
  dialog: 'relative my-auto w-full rounded-2xl border border-border bg-surface-overlay shadow-lg',
  alertdialog:
    'relative my-auto w-full rounded-2xl border border-border bg-surface-overlay shadow-lg',
  'sheet-start':
    'absolute inset-y-0 start-0 w-[min(88vw,22rem)] border-e border-border bg-surface-overlay shadow-lg',
  'sheet-end':
    'absolute inset-y-0 end-0 w-[min(88vw,22rem)] border-s border-border bg-surface-overlay shadow-lg',
  'sheet-bottom':
    'absolute inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl border-t border-border bg-surface-overlay shadow-lg',
};

const PANEL_ENTER: Record<ModalKind, string> = {
  dialog: 'data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out',
  alertdialog: 'data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out',
  'sheet-start': 'data-[state=open]:animate-slide-in-start data-[state=closed]:animate-fade-out',
  'sheet-end': 'data-[state=open]:animate-slide-in-end data-[state=closed]:animate-fade-out',
  'sheet-bottom': 'data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-fade-out',
};

/** The shared engine of Dialog and Sheet: focus trap, Escape, scroll lock, inert background, focus return. */
export function Modal({
  kind,
  open,
  onOpenChange,
  title,
  description,
  hideTitle = false,
  dismissible = true,
  showClose = true,
  initialFocusRef,
  footer,
  children,
  className,
  bodyClassName,
}: ModalCommonProps & { kind: ModalKind }) {
  const { t } = useI18n();
  const { mounted, state } = usePresence(open, EXIT_MS);
  // State, not refs: the portal renders nothing during hydration, so a modal that is open from the
  // very first render only gets its elements one render later, and the setup below must follow them.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const pressedBackdrop = useRef(false);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const token = useId();
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    openModals.push(token);
    return () => {
      openModals.splice(openModals.lastIndexOf(token), 1);
    };
  }, [open, token]);

  useLayoutEffect(() => {
    if (!open || !root || !panel) return;
    // What had focus before the modal took it (not the body, not something inside the modal).
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !panel.contains(active))
      returnFocusTo.current = active;
    const unlockScroll = lockPageScroll();
    const restoreBackground = inertBackground(root);

    const tabbable = getTabbable(panel);
    const initial =
      initialFocusRef?.current ??
      panel.querySelector<HTMLElement>('[data-autofocus]') ??
      tabbable.find((element) => !element.hasAttribute('data-modal-close')) ??
      tabbable[0] ??
      panel;
    initial.focus({ preventScroll: true });

    return () => {
      unlockScroll();
      restoreBackground();
    };
  }, [open, root, panel, initialFocusRef]);

  // Focus goes back in a passive effect on purpose: React re-focuses the element that was focused
  // before a commit once the commit's DOM changes are done, which would undo a focus() made by a
  // layout-effect cleanup.
  useEffect(() => {
    if (!open) return;
    return () => {
      const target = returnFocusTo.current;
      returnFocusTo.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      // A menu or popover inside the modal handles its own Escape first (it prevents the default);
      // a modal below the top one never reacts.
      if (isTopModal(token)) onOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, dismissible, onOpenChange, token]);

  if (!mounted) return null;

  const sheet = kind.startsWith('sheet');
  const close = () => onOpenChange(false);
  return (
    <Portal>
      <div
        ref={setRoot}
        data-state={state}
        className={cn(
          'fixed inset-0 z-[60]',
          !sheet && 'grid overflow-y-auto p-4 sm:p-6',
          state === 'closed' && 'pointer-events-none',
        )}
        onPointerDown={(event) => {
          pressedBackdrop.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          if (dismissible && pressedBackdrop.current && event.target === event.currentTarget)
            close();
          pressedBackdrop.current = false;
        }}
      >
        <div
          aria-hidden="true"
          data-state={state}
          className="pointer-events-none fixed inset-0 bg-scrim backdrop-blur-[3px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
        />
        <div
          ref={setPanel}
          role={kind === 'alertdialog' ? 'alertdialog' : 'dialog'}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          data-state={state}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Tab') trapTab(event, event.currentTarget);
          }}
          className={cn(
            'flex flex-col outline-none',
            PANEL[kind],
            PANEL_ENTER[kind],
            !sheet && 'max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)]',
            className,
          )}
        >
          <div className={cn('flex items-start gap-3 px-5 pt-5', hideTitle ? 'pb-0' : 'pb-3')}>
            <div className="grid min-w-0 flex-1 gap-1">
              <h2
                id={titleId}
                className={cn(
                  'text-lg leading-7 font-semibold text-foreground',
                  hideTitle && 'sr-only',
                )}
              >
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="text-sm text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {showClose ? (
              <IconButton
                label={t('common.actions.close')}
                size="sm"
                data-modal-close=""
                className="-me-1.5 -mt-1"
                onClick={close}
              >
                <X />
              </IconButton>
            ) : null}
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-3', bodyClassName)}>
            {children}
          </div>
          {footer ? (
            <div className="flex flex-col-reverse gap-2 px-5 pt-3 pb-5 sm:flex-row sm:justify-end">
              {footer}
            </div>
          ) : (
            <div className="h-2" />
          )}
        </div>
      </div>
    </Portal>
  );
}

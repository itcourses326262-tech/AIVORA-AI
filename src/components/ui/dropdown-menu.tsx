'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/lib/utils';
import { useFloatingPosition, type Align, type Side } from './floating';
import { createTypeahead, isPrintableKey, nextIndexForKey } from './keyboard';
import { Portal } from './portal';
import { useControllableState } from './use-controllable-state';
import { Slot } from './slot';

interface MenuContextValue {
  close: (options?: { returnFocus?: boolean }) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenu(): MenuContextValue {
  const context = useContext(MenuContext);
  if (!context) throw new Error('Menu items must be used inside <DropdownMenu>');
  return context;
}

const ITEM_SELECTOR = '[role^="menuitem"]:not([aria-disabled="true"])';

export interface DropdownMenuProps {
  /** The element that opens the menu; it must forward `ref` and accept `onClick`/`onKeyDown`. */
  trigger: ReactElement<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }>;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accessible name of the menu; defaults to the trigger's. */
  label?: string;
  side?: Extract<Side, 'top' | 'bottom'>;
  /** Which edge of the trigger the menu lines up with (inline-logical: flips in RTL). */
  align?: Exclude<Align, 'center'>;
  className?: string;
}

/**
 * A menu button with a popup menu: ArrowUp/Down, Home/End, typeahead, Escape, Enter/Space, and
 * Tab to leave. Focus returns to the trigger on close. The popup lines up with the trigger's
 * inline start or end, so it opens toward the right side in Arabic.
 */
export function DropdownMenu({
  trigger,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  label,
  side = 'bottom',
  align = 'start',
  className,
}: DropdownMenuProps) {
  const [open, setOpen] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const menuId = useId();
  const generatedTriggerId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const initialFocus = useRef<'first' | 'last' | 'menu'>('first');
  const typeahead = useRef(createTypeahead());

  const triggerId = trigger.props.id ?? generatedTriggerId;

  const close = useCallback(
    ({ returnFocus = true }: { returnFocus?: boolean } = {}) => {
      setOpen(false);
      if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
    },
    [setOpen],
  );

  useFloatingPosition({
    open,
    anchorRef: triggerRef,
    floatingRef: contentRef,
    side,
    align,
    offset: 6,
  });

  useLayoutEffect(() => {
    if (!open) return;
    const items = contentRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    const target = initialFocus.current === 'last' ? items?.[items.length - 1] : items?.[0];
    (initialFocus.current === 'menu' ? contentRef.current : (target ?? contentRef.current))?.focus({
      preventScroll: true,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, setOpen]);

  const onContentKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
    const current = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      // Leave for the element after the trigger: focus goes back first, then the browser tabs on.
      close();
      return;
    }
    const next = nextIndexForKey(event.key, current, items.length, {
      orientation: 'vertical',
      rtl: false,
    });
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus({ preventScroll: false });
      return;
    }
    if (isPrintableKey(event)) {
      const labels = items.map((item) => item.textContent?.trim() ?? '');
      const match = typeahead.current.match(event.key, labels, current);
      if (match >= 0) {
        event.preventDefault();
        items[match]?.focus();
      }
    }
  };

  const openFrom = (focus: 'first' | 'last' | 'menu') => {
    initialFocus.current = focus;
    setOpen(true);
  };

  return (
    <MenuContext.Provider value={{ close }}>
      <Slot
        ref={triggerRef}
        id={triggerId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          if (open) close({ returnFocus: false });
          // Enter and Space click with `detail` 0: the keyboard user lands on the first item (a
          // visible focus ring), a pointer user on the menu itself so no item looks selected.
          else openFrom(event.detail === 0 ? 'first' : 'menu');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openFrom('first');
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            openFrom('last');
          }
        }}
      >
        {trigger}
      </Slot>
      {open ? (
        <Portal>
          <div
            ref={contentRef}
            id={menuId}
            role="menu"
            tabIndex={-1}
            aria-label={label}
            aria-labelledby={label ? undefined : triggerId}
            aria-orientation="vertical"
            onKeyDown={onContentKeyDown}
            className={cn(
              'fixed z-[70] max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] min-w-[12.5rem] animate-scale-in overflow-y-auto rounded-xl border border-border bg-surface-overlay p-1.5 shadow-lg outline-none',
              'origin-top data-[side=top]:origin-bottom',
              className,
            )}
          >
            {children}
          </div>
        </Portal>
      ) : null}
    </MenuContext.Provider>
  );
}

/** What a link item keeps of the extra props: its identity and its accessibility and test hooks. */
function linkAttributes(props: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(props).filter(
      ([name]) =>
        name === 'id' || name === 'title' || name.startsWith('aria-') || name.startsWith('data-'),
    ),
  );
}

const ITEM_BASE =
  'relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-foreground outline-none transition-colors duration-100 focus:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted';

export interface DropdownMenuItemProps extends Omit<ComponentProps<'button'>, 'onSelect' | 'role'> {
  /** Runs on click or Enter/Space. Call `event.preventDefault()` to keep the menu open. */
  onSelect?: (event: ReactMouseEvent<HTMLElement>) => void;
  /** Renders a link instead of a button; of the other props the link keeps `id`, `title`, `aria-*` and `data-*`. */
  href?: string;
  destructive?: boolean;
  /** Shortcut hint at the inline end. */
  shortcut?: ReactNode;
}

export function DropdownMenuItem({
  onSelect,
  href,
  destructive = false,
  shortcut,
  disabled,
  className,
  children,
  ...props
}: DropdownMenuItemProps) {
  const menu = useMenu();
  const classes = cn(
    ITEM_BASE,
    destructive && 'text-danger focus:bg-danger-soft [&_svg]:text-danger',
    className,
  );
  const handle = (event: ReactMouseEvent<HTMLElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onSelect?.(event);
    // A link navigates, so the menu must not steal focus back from the new page.
    if (!event.defaultPrevented) menu.close({ returnFocus: href === undefined });
  };
  const content = (
    <>
      {children}
      {shortcut ? <span className="ms-auto ps-4 text-xs text-subtle">{shortcut}</span> : null}
    </>
  );
  if (href !== undefined) {
    return (
      <Link
        {...linkAttributes(props)}
        href={href}
        role="menuitem"
        tabIndex={-1}
        aria-disabled={disabled || undefined}
        className={classes}
        onClick={handle}
        onPointerMove={(event) => event.currentTarget.focus({ preventScroll: true })}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      {...props}
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      className={classes}
      onClick={handle}
      onPointerMove={(event) => event.currentTarget.focus({ preventScroll: true })}
    >
      {content}
    </button>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="presentation"
      className={cn('px-2.5 py-1.5 text-xs font-medium text-subtle', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div role="separator" className={cn('-mx-1.5 my-1.5 h-px bg-border', className)} {...props} />
  );
}

interface RadioGroupContextValue {
  value: string;
  select: (value: string) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface DropdownMenuRadioGroupProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}

/** A labelled single-choice section of a menu (language, theme). */
export function DropdownMenuRadioGroup({
  label,
  value,
  onValueChange,
  children,
}: DropdownMenuRadioGroupProps) {
  const labelId = useId();
  return (
    <RadioGroupContext.Provider value={{ value, select: onValueChange }}>
      <div role="group" aria-labelledby={labelId}>
        <DropdownMenuLabel id={labelId}>{label}</DropdownMenuLabel>
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

export interface DropdownMenuRadioItemProps extends Omit<
  ComponentProps<'button'>,
  'value' | 'role' | 'onSelect'
> {
  value: string;
}

export function DropdownMenuRadioItem({
  value,
  disabled,
  className,
  children,
  onClick,
  ...props
}: DropdownMenuRadioItemProps) {
  const menu = useMenu();
  const group = useContext(RadioGroupContext);
  if (!group) throw new Error('DropdownMenuRadioItem must be used inside <DropdownMenuRadioGroup>');
  const checked = group.value === value;
  return (
    <button
      type="button"
      {...props}
      role="menuitemradio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      className={cn(ITEM_BASE, className)}
      onClick={(event) => {
        onClick?.(event);
        if (disabled || event.defaultPrevented) return;
        group.select(value);
        menu.close();
      }}
      onPointerMove={(event) => event.currentTarget.focus({ preventScroll: true })}
    >
      <span className="flex-1">{children}</span>
      <Check
        aria-hidden="true"
        className={cn('text-brand!', checked ? 'opacity-100' : 'opacity-0')}
      />
    </button>
  );
}

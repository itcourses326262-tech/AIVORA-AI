'use client';

import {
  createContext,
  useContext,
  useId,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { isRtl } from './dir';
import { nextIndexForKey } from './keyboard';
import { useControllableState } from './use-controllable-state';

interface TabsContextValue {
  baseId: string;
  value: string;
  select: (value: string) => void;
  activation: 'automatic' | 'manual';
  appearance: 'underline' | 'pills';
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) throw new Error('Tabs components must be used inside <Tabs>');
  return context;
}

const domId = (baseId: string, part: 'tab' | 'panel', value: string) =>
  `${baseId}-${part}-${value.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

export interface TabsProps extends Omit<ComponentProps<'div'>, 'defaultValue' | 'onChange'> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** `automatic` selects on arrow-key focus; `manual` waits for Enter or Space. */
  activation?: 'automatic' | 'manual';
  appearance?: 'underline' | 'pills';
}

/** Tabs with roving tabindex and arrow-key navigation that follows the reading direction. */
export function Tabs({
  value,
  defaultValue = '',
  onValueChange,
  activation = 'automatic',
  appearance = 'underline',
  className,
  ...props
}: TabsProps) {
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [current, setCurrent] = useControllableState({
    value,
    defaultValue,
    onChange: onValueChange,
  });
  return (
    <TabsContext.Provider
      value={{ baseId, value: current, select: setCurrent, activation, appearance }}
    >
      <div className={className} {...props} />
    </TabsContext.Provider>
  );
}

export function TabsList({ className, onKeyDown, ...props }: ComponentProps<'div'>) {
  const { activation, appearance } = useTabs();
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
    );
    const index = tabs.findIndex((tab) => tab === document.activeElement);
    if (index < 0) return;
    const next = nextIndexForKey(event.key, index, tabs.length, {
      orientation: 'horizontal',
      rtl: isRtl(event.currentTarget),
    });
    const target = next === null ? undefined : tabs[next];
    if (!target) return;
    event.preventDefault();
    target.focus();
    if (activation === 'automatic') target.click();
  };
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      {...props}
      onKeyDown={handleKeyDown}
      className={cn(
        'no-scrollbar flex items-center overflow-x-auto',
        appearance === 'underline'
          ? 'gap-1 border-b border-border'
          : 'w-fit max-w-full gap-1 rounded-xl border border-border bg-surface p-1',
        className,
      )}
    />
  );
}

export interface TabsTriggerProps extends Omit<ComponentProps<'button'>, 'value'> {
  value: string;
}

export function TabsTrigger({ value, className, onClick, children, ...props }: TabsTriggerProps) {
  const tabs = useTabs();
  const selected = tabs.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={domId(tabs.baseId, 'tab', value)}
      aria-selected={selected}
      aria-controls={domId(tabs.baseId, 'panel', value)}
      tabIndex={selected ? 0 : -1}
      data-state={selected ? 'active' : 'inactive'}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) tabs.select(value);
      }}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 text-sm font-medium whitespace-nowrap text-muted transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:text-foreground [&_svg]:size-4',
        tabs.appearance === 'underline'
          ? 'h-11 px-3 after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:scale-x-0 after:rounded-full after:bg-brand-gradient after:transition-transform after:duration-200 data-[state=active]:after:scale-x-100'
          : 'h-8 rounded-lg px-3.5 data-[state=active]:bg-surface-overlay data-[state=active]:shadow-sm',
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps extends Omit<ComponentProps<'div'>, 'value'> {
  value: string;
  /** Keep inactive panels in the DOM (hidden) so their state survives tab switches. */
  keepMounted?: boolean;
  children?: ReactNode;
}

export function TabsContent({
  value,
  keepMounted = false,
  className,
  children,
  ...props
}: TabsContentProps) {
  const tabs = useTabs();
  const selected = tabs.value === value;
  if (!selected && !keepMounted) return null;
  return (
    <div
      role="tabpanel"
      id={domId(tabs.baseId, 'panel', value)}
      aria-labelledby={domId(tabs.baseId, 'tab', value)}
      hidden={!selected}
      tabIndex={0}
      {...props}
      className={cn('mt-4 animate-fade-in focus-visible:rounded-lg', className)}
    >
      {children}
    </div>
  );
}

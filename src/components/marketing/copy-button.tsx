'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export interface CopyButtonProps {
  /** The text that lands in the clipboard. */
  text: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
  className?: string;
}

const RESET_MS = 2000;

/** Copies `text`, flips to a check mark for two seconds and announces the result politely. */
export function CopyButton({ text, label, copiedLabel, failedLabel, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error(failedLabel);
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), RESET_MS);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        className={cn(
          'hit-area inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/15 bg-white/[0.06] px-2.5 text-xs font-medium whitespace-nowrap text-[#e6e6f5] transition-colors duration-150 hover:bg-white/[0.12] focus-visible:outline-[#a5b4fc] active:scale-[0.98]',
          className,
        )}
      >
        {copied ? (
          <Check aria-hidden="true" className="size-3.5 text-[#86efac]" />
        ) : (
          <Copy aria-hidden="true" className="size-3.5" />
        )}
        <span>{copied ? copiedLabel : label}</span>
      </button>
      {/* Outside the button, so its name stays one label; present from the start, so a change is announced. */}
      <span role="status" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </>
  );
}

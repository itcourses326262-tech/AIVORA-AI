import type { HttpMethod } from '@/lib/openapi/types';
import { cn } from '@/lib/utils';

const STYLE: Record<HttpMethod, string> = {
  get: 'bg-info-soft text-info',
  head: 'bg-foreground/[0.08] text-muted',
  post: 'bg-success-soft text-success',
  put: 'bg-warning-soft text-warning',
  patch: 'bg-warning-soft text-warning',
  delete: 'bg-danger-soft text-danger',
};

/** GET, POST... in a colour that stays readable in both themes; the word carries the meaning. */
export function MethodBadge({ method, className }: { method: HttpMethod; className?: string }) {
  return (
    <span
      dir="ltr"
      className={cn(
        'inline-flex h-6 min-w-14 items-center justify-center rounded-md px-2 font-mono text-xs font-bold tracking-wide uppercase',
        STYLE[method],
        className,
      )}
    >
      {method}
    </span>
  );
}

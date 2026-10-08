import Link from 'next/link';
import type { ReactNode } from 'react';
import { DEFAULT_NEXT_PATH } from '@/lib/next-path';

/** The title block of an auth card. The page's only `<h1>`. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="grid gap-1.5">
      <h1 className="text-2xl leading-tight font-semibold tracking-tight text-foreground rtl:font-bold">
        {title}
      </h1>
      <p className="text-sm text-muted">{subtitle}</p>
    </div>
  );
}

/** `/register?next=…`, keeping the page the visitor was heading for (the default needs no mention). */
export function authLink(path: '/login' | '/register', next: string): string {
  return next === DEFAULT_NEXT_PATH ? path : `${path}?next=${encodeURIComponent(next)}`;
}

/** "New to AIVORE? Create an account": the way across to the other auth page. */
export function AuthSwitch({
  prompt,
  href,
  children,
}: {
  prompt: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <p className="border-t border-border pt-5 text-center text-sm text-muted">
      {prompt}{' '}
      <Link
        href={href}
        className="rounded-sm font-medium text-brand underline-offset-4 hover:underline"
      >
        {children}
      </Link>
    </p>
  );
}

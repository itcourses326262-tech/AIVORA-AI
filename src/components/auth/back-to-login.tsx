import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Directional } from '@/components/ui/icon';

/** The way back from a recovery form: an arrow that points along the reading direction. */
export function BackToLogin({ children }: { children: string }) {
  return (
    <p className="border-t border-border pt-5 text-center text-sm">
      <Link
        href="/login"
        className="hit-area inline-flex items-center gap-2 rounded-sm font-medium text-brand underline-offset-4 hover:underline"
      >
        <Directional>
          <ArrowLeft className="size-4" />
        </Directional>
        {children}
      </Link>
    </p>
  );
}

import type { GenerationStatus } from '@/lib/api-types';

/*
 * The states of a generation (docs/ARCHITECTURE.md section 8) as an inline SVG. State and event
 * names are API values, so the labels are English and the drawing is left to right in every
 * language; the page explains the same transitions in words next to it. Two drawings share the
 * markup: a wide one from `sm` up and a stacked one for phones, where the wide one would shrink
 * its text to dust. Colours come from the theme tokens, so both themes work.
 */

const NODE_STYLE: Record<GenerationStatus, string> = {
  queued: 'fill-surface-raised stroke-border-strong',
  processing: 'fill-info-soft stroke-info',
  succeeded: 'fill-success-soft stroke-success',
  failed: 'fill-danger-soft stroke-danger',
  canceled: 'fill-surface-raised stroke-muted',
};

interface NodeProps {
  status: GenerationStatus;
  x: number;
  y: number;
  width: number;
}

function Node({ status, x, y, width }: NodeProps) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={44}
        rx={12}
        strokeWidth={1.5}
        className={NODE_STYLE[status]}
      />
      <text
        x={x + width / 2}
        y={y + 27}
        textAnchor="middle"
        className="fill-foreground font-mono text-[13px] font-semibold"
      >
        {status}
      </text>
    </g>
  );
}

const EDGE = 'fill-none stroke-muted';

function Arrowhead({ id }: { id: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX={9}
      refY={5}
      markerWidth={7}
      markerHeight={7}
      orient="auto"
    >
      <path d="M1 1 L9 5 L1 9 z" className="fill-muted" />
    </marker>
  );
}

function Label({
  x,
  y,
  children,
  anchor = 'middle',
}: {
  x: number;
  y: number;
  children: string;
  anchor?: 'start' | 'middle' | 'end';
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="fill-muted font-mono text-[11px]">
      {children}
    </text>
  );
}

export interface LifecycleDiagramProps {
  /** Short accessible name. */
  title: string;
  /** The transitions in words, for people who cannot see the drawing. */
  description: string;
}

export function LifecycleDiagram({ title, description }: LifecycleDiagramProps) {
  return (
    <div dir="ltr" className="rounded-2xl border border-border bg-surface p-4 sm:p-6">
      <svg
        role="img"
        aria-label={`${title}. ${description}`}
        viewBox="0 0 760 250"
        className="hidden h-auto w-full sm:block"
      >
        <title>{title}</title>
        <desc>{description}</desc>
        <defs>
          <Arrowhead id="lifecycle-arrow-wide" />
        </defs>
        <Node status="queued" x={24} y={103} width={132} />
        <Node status="processing" x={268} y={103} width={132} />
        <Node status="succeeded" x={604} y={24} width={132} />
        <Node status="failed" x={604} y={103} width={132} />
        <Node status="canceled" x={604} y={188} width={132} />
        <g className={EDGE} strokeWidth={1.5} markerEnd="url(#lifecycle-arrow-wide)">
          <path d="M156 125 H268" />
          <path d="M400 113 H478 V46 H604" />
          <path d="M400 125 H604" />
          <path d="M400 137 H478 V198 H604" />
          <path d="M90 147 V222 H604" />
        </g>
        <Label x={212} y={116}>
          picked up
        </Label>
        <Label x={541} y={38}>
          outputs stored
        </Label>
        <Label x={541} y={117}>
          error, timeout
        </Label>
        <Label x={541} y={190}>
          cancel
        </Label>
        <Label x={340} y={214}>
          cancel
        </Label>
      </svg>

      <svg
        role="img"
        aria-label={`${title}. ${description}`}
        viewBox="0 0 360 340"
        className="h-auto w-full max-w-sm sm:hidden"
      >
        <title>{title}</title>
        <desc>{description}</desc>
        <defs>
          <Arrowhead id="lifecycle-arrow-narrow" />
        </defs>
        <Node status="queued" x={114} y={8} width={132} />
        <Node status="processing" x={114} y={104} width={132} />
        <Node status="succeeded" x={6} y={268} width={104} />
        <Node status="failed" x={128} y={268} width={104} />
        <Node status="canceled" x={250} y={268} width={104} />
        <g className={EDGE} strokeWidth={1.5} markerEnd="url(#lifecycle-arrow-narrow)">
          <path d="M180 52 V104" />
          <path d="M160 148 L58 268" />
          <path d="M180 148 V268" />
          <path d="M200 148 L302 268" />
          <path d="M246 30 H340 V268" />
        </g>
        <Label x={186} y={84} anchor="start">
          picked up
        </Label>
        <Label x={8} y={190} anchor="start">
          outputs stored
        </Label>
        <Label x={186} y={214} anchor="start">
          error
        </Label>
        <Label x={296} y={200} anchor="start">
          cancel
        </Label>
        <Label x={334} y={96} anchor="end">
          cancel
        </Label>
      </svg>
    </div>
  );
}

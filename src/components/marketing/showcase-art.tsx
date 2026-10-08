import type { ReactNode } from 'react';
import type { ArtKind, ArtPalette, ShowcaseSize } from './showcase-data';
import styles from './marketing.module.css';

/*
 * Abstract artwork for the sample creations: pure SVG, deterministic (a seeded generator, no
 * Math.random), so the server and the browser always agree. It is decorative and hidden from
 * assistive technology; the card around it carries the text.
 */

/** Drawing area per mosaic footprint. The SVG scales to cover the card (`slice`). */
const BOX: Record<ShowcaseSize, readonly [number, number]> = {
  hero: [400, 400],
  square: [400, 400],
  tall: [300, 560],
  wide: [600, 300],
};

/** Backgrounds extend this far past the edge so the slow video drift never shows a gap. */
const PAD = 40;

const num = (value: number) => String(Math.round(value * 10) / 10);

/** mulberry32: a tiny seeded generator. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Point = readonly [number, number];

/** A filled shape under a smooth line through `points`, closed along the bottom edge. */
function smoothRidge(points: readonly Point[], width: number, height: number): string {
  const [first, ...rest] = points;
  if (!first) return '';
  let d = `M${num(-PAD)} ${num(height + PAD)} L${num(-PAD)} ${num(first[1])} L${num(first[0])} ${num(first[1])}`;
  rest.forEach((point, index) => {
    const next = rest[index + 1];
    d += next
      ? ` Q${num(point[0])} ${num(point[1])} ${num((point[0] + next[0]) / 2)} ${num((point[1] + next[1]) / 2)}`
      : ` L${num(point[0])} ${num(point[1])}`;
  });
  return `${d} L${num(width + PAD)} ${num(height + PAD)} Z`;
}

/** A filled shape under straight segments through `points` (jagged peaks). */
function jaggedRidge(points: readonly Point[], width: number, height: number): string {
  const line = points.map(([x, y]) => `L${num(x)} ${num(y)}`).join(' ');
  return `M${num(-PAD)} ${num(height + PAD)} ${line} L${num(width + PAD)} ${num(height + PAD)} Z`;
}

/** A line across the drawing at `base`, wobbling by two sines and a little noise. */
function wave(
  width: number,
  base: number,
  amplitude: number,
  cycles: number,
  phase: number,
  steps: number,
  noise?: () => number,
  jitter = 0,
): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const x = (index / steps) * width;
    const angle = (index / steps) * Math.PI * 2 * cycles + phase;
    const y =
      base +
      amplitude * (Math.sin(angle) * 0.7 + Math.sin(angle * 2.3 + phase) * 0.3) +
      (noise ? (noise() - 0.5) * jitter : 0);
    return [x, y] as const;
  });
}

/** Points of a star with `points` tips alternating between the outer and inner radius. */
function starPath(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const vertices = Array.from({ length: points * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (index / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    return `${num(cx + radius * Math.cos(angle))} ${num(cy + radius * Math.sin(angle))}`;
  });
  return `M${vertices.join(' L')} Z`;
}

interface ArtProps {
  /** Unique per card: prefixes gradient ids. */
  uid: string;
  palette: ArtPalette;
  width: number;
  height: number;
}

const bg = (width: number, height: number) => ({
  x: -PAD,
  y: -PAD,
  width: width + PAD * 2,
  height: height + PAD * 2,
});

function Stars({
  width,
  height,
  count,
  seed,
  fill,
  maxY = 1,
}: {
  width: number;
  height: number;
  count: number;
  seed: number;
  fill: string;
  maxY?: number;
}) {
  const random = seeded(seed);
  return (
    <>
      {Array.from({ length: count }, (_, index) => {
        const cx = random() * width;
        const cy = random() * height * maxY;
        const r = 0.5 + random() * 1.3;
        return (
          <circle
            key={index}
            cx={num(cx)}
            cy={num(cy)}
            r={num(r)}
            fill={fill}
            opacity={num(0.4 + random() * 0.6)}
            className={index % 3 === 0 ? styles.twinkle : undefined}
          />
        );
      })}
    </>
  );
}

function Dunes({ uid, palette, width, height }: ArtProps) {
  const [deep, dark, mid, light, glow] = palette;
  const layers = [dark, mid, light, deep];
  const horizon = height * 0.5;
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={deep} />
          <stop offset="0.5" stopColor={dark} />
          <stop offset="0.82" stopColor={mid} />
          <stop offset="1" stopColor={light} />
        </linearGradient>
        <radialGradient id={`${uid}-halo`}>
          <stop offset="0" stopColor={glow} stopOpacity="0.95" />
          <stop offset="0.35" stopColor={light} stopOpacity="0.4" />
          <stop offset="1" stopColor={light} stopOpacity="0" />
        </radialGradient>
        {layers.map((color, index) => (
          <linearGradient
            key={color + index}
            id={`${uid}-dune-${index}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0" stopColor={color} />
            <stop offset="1" stopColor={deep} stopOpacity="0.85" />
          </linearGradient>
        ))}
      </defs>
      <rect {...bg(width, height)} fill={`url(#${uid}-sky)`} />
      <Stars width={width} height={height} count={26} seed={7} fill="#fff" maxY={0.34} />
      <circle
        cx={width * 0.5}
        cy={horizon - height * 0.04}
        r={height * 0.46}
        fill={`url(#${uid}-halo)`}
      />
      <circle cx={width * 0.5} cy={horizon - height * 0.04} r={height * 0.07} fill={glow} />
      {layers.map((_, index) => (
        <path
          key={index}
          d={smoothRidge(
            wave(
              width,
              horizon + height * (0.04 + index * 0.1),
              height * (0.035 + index * 0.012),
              1.15 + index * 0.35,
              index * 1.7 + 0.4,
              14,
            ),
            width,
            height,
          )}
          fill={`url(#${uid}-dune-${index})`}
        />
      ))}
    </>
  );
}

function Skyline({ uid, palette, width, height }: ArtProps) {
  const [deep, dark, mid, light, glow] = palette;
  const ground = height * 0.8;
  const random = seeded(21);
  const towers = (minHeight: number, maxHeight: number, fill: string, lit: number) => {
    const shapes: ReactNode[] = [];
    let x = -6;
    let index = 0;
    while (x < width + 6) {
      const w = 22 + random() * 26;
      const h = height * (minHeight + random() * (maxHeight - minHeight));
      shapes.push(
        <rect
          key={`b${index}`}
          x={num(x)}
          y={num(ground - h)}
          width={num(w)}
          height={num(h)}
          fill={fill}
        />,
      );
      for (let wy = ground - h + 10; wy < ground - 12; wy += 12) {
        for (let wx = x + 5; wx < x + w - 6; wx += 8) {
          if (random() < lit) {
            shapes.push(
              <rect
                key={`w${index}-${num(wx)}-${num(wy)}`}
                x={num(wx)}
                y={num(wy)}
                width="3.2"
                height="5"
                rx="0.6"
                fill={random() < 0.5 ? glow : light}
                opacity={num(0.5 + random() * 0.5)}
              />,
            );
          }
        }
      }
      x += w + 2 + random() * 3;
      index += 1;
    }
    return shapes;
  };
  const rain = seeded(33);
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={deep} />
          <stop offset="0.55" stopColor={dark} />
          <stop offset="1" stopColor={mid} />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="0.5" cy="1" r="0.8">
          <stop offset="0" stopColor={light} stopOpacity="0.55" />
          <stop offset="0.5" stopColor={mid} stopOpacity="0.25" />
          <stop offset="1" stopColor={mid} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-wet`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={light} stopOpacity="0.5" />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
      </defs>
      <rect {...bg(width, height)} fill={`url(#${uid}-sky)`} />
      <rect {...bg(width, height)} fill={`url(#${uid}-glow)`} />
      {towers(0.22, 0.5, dark, 0.18)}
      {towers(0.12, 0.38, deep, 0.32)}
      <rect
        x={-PAD}
        y={ground}
        width={width + PAD * 2}
        height={height - ground + PAD}
        fill={`url(#${uid}-wet)`}
      />
      {[0.18, 0.37, 0.6, 0.82].map((position, index) => (
        <rect
          key={position}
          x={num(width * position)}
          y={ground}
          width="3"
          height={num(height * 0.2)}
          fill={index % 2 === 0 ? glow : light}
          opacity="0.55"
        />
      ))}
      {Array.from({ length: 46 }, (_, index) => {
        const x = rain() * (width + 60) - 20;
        const y = rain() * height;
        const length = 14 + rain() * 22;
        return (
          <line
            key={index}
            x1={num(x)}
            y1={num(y)}
            x2={num(x - length * 0.25)}
            y2={num(y + length)}
            stroke="#fff"
            strokeWidth="0.8"
            opacity={num(0.1 + rain() * 0.2)}
          />
        );
      })}
    </>
  );
}

function Bloom({ uid, palette, width, height }: ArtProps) {
  const [deep, dark, mid, light, glow] = palette;
  const cx = width / 2;
  const cy = height / 2;
  const petals = [
    { count: 12, length: height * 0.4, offset: 0, opacity: 0.55 },
    { count: 10, length: height * 0.3, offset: 9, opacity: 0.75 },
    { count: 8, length: height * 0.2, offset: 0, opacity: 0.95 },
  ];
  const random = seeded(5);
  return (
    <>
      <defs>
        <radialGradient id={`${uid}-bg`} cx="0.5" cy="0.5" r="0.7">
          <stop offset="0" stopColor={mid} stopOpacity="0.55" />
          <stop offset="0.55" stopColor={dark} />
          <stop offset="1" stopColor={deep} />
        </radialGradient>
        <linearGradient id={`${uid}-petal`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.7" stopColor={mid} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
        <radialGradient id={`${uid}-core`}>
          <stop offset="0" stopColor={glow} />
          <stop offset="0.4" stopColor={glow} stopOpacity="0.6" />
          <stop offset="1" stopColor={glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect {...bg(width, height)} fill={`url(#${uid}-bg)`} />
      <g transform={`translate(${num(cx)} ${num(cy)})`}>
        {petals.map((layer, layerIndex) =>
          Array.from({ length: layer.count }, (_, index) => (
            <ellipse
              key={`${layerIndex}-${index}`}
              cx="0"
              cy={num(-layer.length / 2)}
              rx={num(layer.length * 0.21)}
              ry={num(layer.length / 2)}
              fill={`url(#${uid}-petal)`}
              stroke={glow}
              strokeOpacity="0.35"
              strokeWidth="0.8"
              opacity={layer.opacity}
              transform={`rotate(${num((index * 360) / layer.count + layer.offset)})`}
            />
          )),
        )}
        <circle r={num(height * 0.2)} fill={`url(#${uid}-core)`} />
        <circle r={num(height * 0.03)} fill={glow} />
      </g>
      {Array.from({ length: 16 }, (_, index) => (
        <circle
          key={index}
          cx={num(random() * width)}
          cy={num(random() * height)}
          r={num(1 + random() * 2)}
          fill={glow}
          opacity={num(0.3 + random() * 0.5)}
          className={index % 2 === 0 ? styles.twinkle : undefined}
        />
      ))}
    </>
  );
}

function Orbit({ uid, palette, width, height }: ArtProps) {
  const [deep, dark, mid, light, glow] = palette;
  const cx = width / 2;
  const cy = height / 2;
  const radius = height * 0.2;
  const ring = { rx: height * 0.4, ry: height * 0.1 };
  const tilt = `rotate(-18 ${num(cx)} ${num(cy)})`;
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-space`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={deep} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
        <radialGradient id={`${uid}-nebula`} cx="0.75" cy="0.2" r="0.6">
          <stop offset="0" stopColor={mid} stopOpacity="0.55" />
          <stop offset="1" stopColor={mid} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-planet`} cx="0.34" cy="0.3" r="0.8">
          <stop offset="0" stopColor={light} />
          <stop offset="0.45" stopColor={mid} />
          <stop offset="1" stopColor={deep} />
        </radialGradient>
        <linearGradient id={`${uid}-ring`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={glow} stopOpacity="0.1" />
          <stop offset="0.5" stopColor={glow} stopOpacity="0.9" />
          <stop offset="1" stopColor={glow} stopOpacity="0.1" />
        </linearGradient>
        <clipPath id={`${uid}-planet-clip`}>
          <circle cx={num(cx)} cy={num(cy)} r={num(radius)} />
        </clipPath>
        <clipPath id={`${uid}-back`}>
          <rect
            x={num(-PAD)}
            y={num(-PAD)}
            width={num(width + PAD * 2)}
            height={num(cy + PAD)}
            transform={tilt}
          />
        </clipPath>
        <clipPath id={`${uid}-front`}>
          <rect
            x={num(-PAD)}
            y={num(cy)}
            width={num(width + PAD * 2)}
            height={num(height)}
            transform={tilt}
          />
        </clipPath>
      </defs>
      <rect {...bg(width, height)} fill={`url(#${uid}-space)`} />
      <rect {...bg(width, height)} fill={`url(#${uid}-nebula)`} />
      <Stars width={width} height={height} count={64} seed={12} fill="#fff" />
      <g clipPath={`url(#${uid}-back)`}>
        <ellipse
          cx={num(cx)}
          cy={num(cy)}
          rx={num(ring.rx)}
          ry={num(ring.ry)}
          fill="none"
          stroke={`url(#${uid}-ring)`}
          strokeWidth="9"
          transform={tilt}
        />
      </g>
      <circle cx={num(cx)} cy={num(cy)} r={num(radius)} fill={`url(#${uid}-planet)`} />
      <g clipPath={`url(#${uid}-planet-clip)`} opacity="0.28">
        {[-0.55, -0.15, 0.3, 0.62].map((offset) => (
          <rect
            key={offset}
            x={num(cx - radius)}
            y={num(cy + offset * radius)}
            width={num(radius * 2)}
            height={num(radius * 0.16)}
            fill={offset < 0 ? deep : light}
            transform={`rotate(-8 ${num(cx)} ${num(cy)})`}
          />
        ))}
      </g>
      <g clipPath={`url(#${uid}-front)`}>
        <ellipse
          cx={num(cx)}
          cy={num(cy)}
          rx={num(ring.rx)}
          ry={num(ring.ry)}
          fill="none"
          stroke={`url(#${uid}-ring)`}
          strokeWidth="9"
          transform={tilt}
        />
        <ellipse
          cx={num(cx)}
          cy={num(cy)}
          rx={num(ring.rx * 0.88)}
          ry={num(ring.ry * 0.88)}
          fill="none"
          stroke={glow}
          strokeOpacity="0.3"
          strokeWidth="1.2"
          transform={tilt}
        />
      </g>
      <circle cx={num(width * 0.8)} cy={num(height * 0.24)} r="9" fill={light} opacity="0.9" />
      <circle
        cx={num(width * 0.8 + 3)}
        cy={num(height * 0.24 - 2)}
        r="9"
        fill={dark}
        opacity="0.35"
      />
    </>
  );
}

function Tides({ uid, palette, width, height }: ArtProps) {
  const [deep, dark, mid, light, glow] = palette;
  const horizon = height * 0.5;
  const random = seeded(44);
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dark} />
          <stop offset="0.7" stopColor={light} />
          <stop offset="1" stopColor={glow} />
        </linearGradient>
        <radialGradient id={`${uid}-halo`}>
          <stop offset="0" stopColor={glow} stopOpacity="0.95" />
          <stop offset="1" stopColor={glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-sea`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mid} />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
      </defs>
      <rect {...bg(width, height)} fill={`url(#${uid}-sky)`} />
      <circle
        cx={num(width * 0.5)}
        cy={num(horizon)}
        r={num(height * 0.5)}
        fill={`url(#${uid}-halo)`}
      />
      <circle
        cx={num(width * 0.5)}
        cy={num(horizon - height * 0.02)}
        r={num(height * 0.1)}
        fill={glow}
      />
      <rect
        x={-PAD}
        y={num(horizon)}
        width={width + PAD * 2}
        height={height - horizon + PAD}
        fill={`url(#${uid}-sea)`}
      />
      {Array.from({ length: 9 }, (_, index) => (
        <ellipse
          key={index}
          cx={num(width * 0.5 + (random() - 0.5) * 16)}
          cy={num(horizon + 8 + index * height * 0.045)}
          rx={num(14 + index * 9)}
          ry="1.8"
          fill={glow}
          opacity={num(0.85 - index * 0.08)}
        />
      ))}
      {[0, 1, 2, 3].map((index) => {
        const points = wave(
          width,
          horizon + height * (0.12 + index * 0.1),
          height * (0.012 + index * 0.012),
          3 - index * 0.5,
          index * 1.3,
          18,
        );
        const crest = points
          .map(([x, y], pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${num(x)} ${num(y)}`)
          .join(' ');
        return (
          <g key={index}>
            <path
              d={smoothRidge(points, width, height)}
              fill={index % 2 === 0 ? dark : deep}
              opacity={num(0.55 + index * 0.12)}
            />
            <path
              d={crest}
              fill="none"
              stroke="#fff"
              strokeOpacity={num(0.18 + index * 0.1)}
              strokeWidth="1.2"
            />
          </g>
        );
      })}
    </>
  );
}

function Peaks({ uid, palette, width, height }: ArtProps) {
  const [deep, dark, mid, light, glow] = palette;
  const moon = { x: width * 0.66, y: height * 0.27, r: height * 0.085 };
  const ridge = (base: number, amplitude: number, seed: number) => {
    const random = seeded(seed);
    return Array.from({ length: 10 }, (_, index) => {
      const x = (index / 9) * width;
      const y = base - random() * amplitude * (index % 2 === 0 ? 1 : 0.35);
      return [x, y] as const;
    });
  };
  const layers = [
    { points: ridge(height * 0.62, height * 0.2, 3), top: height * 0.38, fill: [light, mid] },
    { points: ridge(height * 0.74, height * 0.22, 9), top: height * 0.5, fill: [mid, dark] },
    { points: ridge(height * 0.88, height * 0.16, 14), top: height * 0.7, fill: [dark, deep] },
  ] as const;
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={deep} />
          <stop offset="0.6" stopColor={dark} />
          <stop offset="1" stopColor={mid} />
        </linearGradient>
        <radialGradient id={`${uid}-halo`}>
          <stop offset="0" stopColor={glow} stopOpacity="0.55" />
          <stop offset="1" stopColor={glow} stopOpacity="0" />
        </radialGradient>
        {layers.map((layer, index) => (
          <linearGradient
            key={index}
            id={`${uid}-ridge-${index}`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1={num(layer.top)}
            x2="0"
            y2={num(layer.top + height * 0.3)}
          >
            <stop offset="0" stopColor={layer.fill[0]} />
            <stop offset="1" stopColor={layer.fill[1]} />
          </linearGradient>
        ))}
        <linearGradient id={`${uid}-mist`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mid} stopOpacity="0" />
          <stop offset="1" stopColor={deep} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect {...bg(width, height)} fill={`url(#${uid}-sky)`} />
      <Stars width={width} height={height} count={54} seed={31} fill="#fff" maxY={0.55} />
      <circle cx={num(moon.x)} cy={num(moon.y)} r={num(moon.r * 4.2)} fill={`url(#${uid}-halo)`} />
      <circle cx={num(moon.x)} cy={num(moon.y)} r={num(moon.r)} fill={glow} />
      <circle
        cx={num(moon.x - moon.r * 0.3)}
        cy={num(moon.y - moon.r * 0.2)}
        r={num(moon.r * 0.22)}
        fill={light}
        opacity="0.35"
      />
      <circle
        cx={num(moon.x + moon.r * 0.35)}
        cy={num(moon.y + moon.r * 0.3)}
        r={num(moon.r * 0.15)}
        fill={light}
        opacity="0.3"
      />
      {layers.map((layer, index) => (
        <path
          key={index}
          d={jaggedRidge(layer.points, width, height)}
          fill={`url(#${uid}-ridge-${index})`}
        />
      ))}
      <rect
        x={-PAD}
        y={num(height * 0.68)}
        width={width + PAD * 2}
        height={num(height * 0.32 + PAD)}
        fill={`url(#${uid}-mist)`}
      />
    </>
  );
}

function Arches({ uid, palette, width, height }: ArtProps) {
  const [deep, dark, mid, light, glow] = palette;
  const cx = width / 2;
  const base = height * 0.92;
  const arch = (w: number, h: number) =>
    `M${num(cx - w / 2)} ${num(base)} L${num(cx - w / 2)} ${num(base - h * 0.55)} C${num(cx - w / 2)} ${num(base - h * 0.8)} ${num(cx - w * 0.14)} ${num(base - h * 0.93)} ${num(cx)} ${num(base - h)} C${num(cx + w * 0.14)} ${num(base - h * 0.93)} ${num(cx + w / 2)} ${num(base - h * 0.8)} ${num(cx + w / 2)} ${num(base - h * 0.55)} L${num(cx + w / 2)} ${num(base)} Z`;
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={dark} />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
        <pattern id={`${uid}-tile`} width="80" height="80" patternUnits="userSpaceOnUse">
          <path
            d={starPath(40, 40, 34, 17, 8)}
            fill="none"
            stroke={light}
            strokeOpacity="0.5"
            strokeWidth="1.2"
          />
          <path d={starPath(40, 40, 15, 8, 8)} fill={mid} fillOpacity="0.35" />
          <circle cx="0" cy="0" r="4" fill="none" stroke={light} strokeOpacity="0.4" />
          <circle cx="80" cy="0" r="4" fill="none" stroke={light} strokeOpacity="0.4" />
          <circle cx="0" cy="80" r="4" fill="none" stroke={light} strokeOpacity="0.4" />
          <circle cx="80" cy="80" r="4" fill="none" stroke={light} strokeOpacity="0.4" />
        </pattern>
        <linearGradient id={`${uid}-window`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={glow} />
          <stop offset="0.5" stopColor={light} />
          <stop offset="1" stopColor={mid} />
        </linearGradient>
        <radialGradient id={`${uid}-vignette`} cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.5" stopColor={deep} stopOpacity="0" />
          <stop offset="1" stopColor={deep} stopOpacity="0.85" />
        </radialGradient>
      </defs>
      <rect {...bg(width, height)} fill={`url(#${uid}-bg)`} />
      <rect {...bg(width, height)} fill={`url(#${uid}-tile)`} />
      <path d={arch(width * 0.66, height * 0.8)} fill={deep} stroke={light} strokeWidth="3" />
      <path
        d={arch(width * 0.54, height * 0.68)}
        fill={`url(#${uid}-window)`}
        stroke={glow}
        strokeWidth="1.6"
      />
      <path
        d={starPath(cx, height * 0.5, height * 0.1, height * 0.05, 8)}
        fill={deep}
        fillOpacity="0.55"
        stroke={deep}
        strokeWidth="1"
      />
      <rect {...bg(width, height)} fill={`url(#${uid}-vignette)`} />
    </>
  );
}

const ARTWORKS: Record<ArtKind, (props: ArtProps) => ReactNode> = {
  dunes: Dunes,
  skyline: Skyline,
  bloom: Bloom,
  orbit: Orbit,
  tides: Tides,
  peaks: Peaks,
  arches: Arches,
};

export interface ShowcaseArtProps {
  art: ArtKind;
  size: ShowcaseSize;
  palette: ArtPalette;
  uid: string;
  /** Video samples drift slowly, like a motion preview. */
  moving?: boolean;
  className?: string;
}

export function ShowcaseArt({
  art,
  size,
  palette,
  uid,
  moving = false,
  className,
}: ShowcaseArtProps) {
  const [width, height] = BOX[size];
  const Artwork = ARTWORKS[art];
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <g className={moving ? styles.pan : undefined}>
        <Artwork uid={uid} palette={palette} width={width} height={height} />
      </g>
    </svg>
  );
}

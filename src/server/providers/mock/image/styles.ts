import 'server-only';
import { mixRgb, toHex, type Rgb } from '../color';
import { fbm } from '../noise';
import type { ArtStyle } from '../moods';
import type { SoftLight } from './lights';
import type { Scene, StyleLayers } from './scene';
import { disc, fmt, linear, radial } from './svg';

type Fragment = Pick<StyleLayers, 'defs' | 'lights' | 'glow'>;

/** Stars and bokeh: lights, so they sit under the solid shapes and are added to the picture. */
function dust(scene: Scene, maxY: number): Fragment {
  const { width, unit, rng, palette } = scene;
  const night = palette.dark;
  const starCount = night ? rng.int(70, 130) : rng.int(18, 36);
  const bokehCount = rng.int(night ? 6 : 8, night ? 12 : 14);
  const lights: SoftLight[] = [];
  for (let i = 0; i < bokehCount; i++) {
    lights.push({
      kind: 'disc',
      x: rng.range(0, width),
      y: rng.range(0, maxY),
      radius: unit * rng.range(0.012, 0.05),
      color: rng.chance(0.5) ? palette.glow : palette.accent,
      stops: [
        [0, rng.range(0.1, 0.32) * 0.9],
        [1, 0],
      ],
    });
  }
  let glow = '';
  const fill = toHex(palette.glow);
  for (let i = 0; i < starCount; i++) {
    const radius = Math.max(0.7, unit * rng.range(0.0007, 0.0028));
    glow += `<circle cx="${fmt(rng.range(0, width))}" cy="${fmt(rng.range(0, maxY))}" r="${fmt(radius)}" fill="${fill}" opacity="${fmt(rng.range(0.25, 1))}"/>`;
  }
  return { defs: '', lights, glow };
}

function ring(cx: number, cy: number, radius: number, color: Rgb, width: number, opacity: number) {
  return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(radius)}" fill="none" stroke="${toHex(color)}" stroke-width="${fmt(width)}" opacity="${fmt(opacity)}"/>`;
}

function aurora(scene: Scene): StyleLayers {
  const { width, height, unit, rng, palette: p } = scene;
  const dusty = dust(scene, height);
  const lights = dusty.lights;
  const colours = [p.accent, p.glow, p.ramp[3], p.ramp[4], p.ramp[2]];
  // Light palettes would clip to white under the screen blend, so their lights are dimmer.
  const gain = p.dark ? 1 : 0.5;

  const orbs = rng.int(3, 5);
  for (let i = 0; i < orbs; i++) {
    lights.push({
      kind: 'disc',
      x: width * rng.range(0.08, 0.92),
      y: height * rng.range(0.08, 0.92),
      radius: unit * rng.range(0.22, 0.55),
      color: colours[i % colours.length] as Rgb,
      stops: [
        [0, 0.6 * gain],
        [0.5, 0.2 * gain],
        [1, 0],
      ],
    });
  }

  // Slanted shafts of light, long enough to leave the canvas on both ends.
  const lean = rng.range(-24, 24);
  const shafts = rng.int(4, 7);
  for (let i = 0; i < shafts; i++) {
    lights.push({
      kind: 'shaft',
      x: width * rng.range(0.05, 0.95),
      y: height / 2,
      angleDeg: lean + rng.range(-5, 5),
      width: unit * rng.range(0.05, 0.22),
      color: colours[(i + 1) % colours.length] as Rgb,
      opacity: rng.range(0.14, 0.3) * gain,
    });
  }

  // A bright core with a few thin rings around it: the focal point of the composition.
  const cx = width * rng.range(0.34, 0.66);
  const cy = height * rng.range(0.36, 0.6);
  const core = unit * rng.range(0.1, 0.17);
  lights.push(
    {
      kind: 'disc',
      x: cx,
      y: cy,
      radius: core * 3.4,
      color: p.glow,
      stops: [
        [0, gain],
        [0.18, 0.85 * gain],
        [0.5, 0.3 * gain],
        [1, 0],
      ],
    },
    {
      kind: 'disc',
      x: cx,
      y: cy,
      radius: core * 3.4,
      color: p.accent,
      stops: [
        [0.15, 0],
        [0.5, 0.3 * gain],
        [1, 0],
      ],
    },
  );
  let shapes = '';
  const rings = rng.int(2, 4);
  for (let i = 1; i <= rings; i++) {
    shapes += ring(cx, cy, core * (0.9 + 0.55 * i), p.glow, unit * 0.0022, 0.5 / i);
  }
  return { defs: dusty.defs, lights, glow: dusty.glow, shapes };
}

function ridge(scene: Scene, baseY: number, amplitude: number, roughness: number, offset: number) {
  const { width, height, noise } = scene;
  const steps = 140;
  let path = `M0 ${fmt(height)}`;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lift = fbm(noise, t * roughness + offset, offset * 0.37 + 3.1, 4) * 1.25;
    path += ` L${fmt(t * width)} ${fmt(baseY - amplitude * lift)}`;
  }
  return `${path} L${fmt(width)} ${fmt(height)} Z`;
}

function horizon(scene: Scene): StyleLayers {
  const { width, height, unit, rng, palette: p } = scene;
  const horizonY = height * rng.range(0.56, 0.7);
  const dusty = dust(scene, horizonY);
  const sunX = width * rng.range(0.25, 0.75);
  const sunY = horizonY - unit * rng.range(0.02, 0.22);
  const sunR = unit * rng.range(0.07, 0.15);

  const lights = dusty.lights;
  lights.push(
    {
      kind: 'disc',
      x: sunX,
      y: sunY,
      radius: unit * 0.95,
      color: p.glow,
      stops: [
        [0, 0.8],
        [0.25, 0.35],
        [1, 0],
      ],
    },
    {
      kind: 'disc',
      x: sunX,
      y: sunY,
      radius: unit * 0.95,
      color: p.accent,
      stops: [
        [0, 0],
        [0.25, 0.3],
        [1, 0],
      ],
    },
  );
  let defs = dusty.defs;
  defs += radial('hs', [
    { offset: 0, color: mixRgb(p.glow, p.accent, 0.08), opacity: 1 },
    { offset: 0.72, color: mixRgb(p.glow, p.accent, 0.22), opacity: 1 },
    { offset: 0.95, color: mixRgb(p.glow, p.accent, 0.4), opacity: 0.95 },
    { offset: 1, color: mixRgb(p.glow, p.accent, 0.4), opacity: 0 },
  ]);
  defs += radial('hw', [
    { offset: 0, color: p.glow, opacity: 0.35 },
    { offset: 1, color: p.glow, opacity: 0 },
  ]);
  const glow =
    disc(sunX, sunY, sunR, 'hs') +
    `<ellipse cx="${fmt(sunX)}" cy="${fmt(horizonY + unit * 0.02)}" rx="${fmt(unit * 0.5)}" ry="${fmt(unit * 0.05)}" fill="url(#hw)"/>` +
    dusty.glow;

  const haze = mixRgb(p.ramp[2], p.glow, 0.28);
  const layers = rng.int(4, 6);
  let shapes = '';
  for (let i = 0; i < layers; i++) {
    const depth = i / (layers - 1);
    const colour = mixRgb(haze, p.ink, Math.pow(depth, 0.85) * 0.96 + 0.04);
    const mist = mixRgb(colour, haze, 0.6 * (1 - depth));
    const baseY = horizonY + (height - horizonY) * depth * 0.85;
    defs += linear('hr' + i, { x: 0, y: baseY - unit * 0.2 }, { x: 0, y: height }, [
      { offset: 0, color: colour, opacity: 1 },
      { offset: 1, color: mist, opacity: 1 },
    ]);
    const amplitude = unit * (0.07 + 0.05 * i);
    const path = ridge(scene, baseY, amplitude, 1.4 + i * 0.9, rng.range(0, 90));
    shapes += `<path d="${path}" fill="url(#hr${i})"/>`;
  }
  return { defs, lights, glow, shapes };
}

function orbit(scene: Scene): StyleLayers {
  const { width, height, unit, rng, palette: p } = scene;
  const dusty = dust(scene, height);
  const radius = unit * rng.range(0.19, 0.28);
  const cx = width * rng.range(0.38, 0.62);
  const cy = height * rng.range(0.4, 0.6);
  const tilt = rng.range(-28, -12) * (rng.chance(0.5) ? 1 : -1);

  const lights = dusty.lights;
  lights.push(
    {
      kind: 'disc',
      x: cx,
      y: cy,
      radius: radius * 3,
      color: p.accent,
      stops: [
        [0.25, 0.5],
        [0.6, 0.12],
        [1, 0],
      ],
    },
    {
      kind: 'disc',
      x: cx,
      y: cy,
      radius: radius * 3,
      color: p.ramp[3],
      stops: [
        [0.25, 0],
        [0.6, 0.14],
        [1, 0],
      ],
    },
  );
  let defs = dusty.defs;
  defs += radial(
    'op',
    [
      { offset: 0, color: p.glow, opacity: 1 },
      { offset: 0.38, color: p.ramp[3], opacity: 1 },
      { offset: 0.75, color: p.ramp[2], opacity: 1 },
      { offset: 1, color: p.ramp[0], opacity: 1 },
    ],
    { x: 0.3, y: 0.28 },
  );
  defs += radial(
    'ot',
    [
      { offset: 0.45, color: p.ink, opacity: 0 },
      { offset: 1, color: p.ink, opacity: 0.78 },
    ],
    { x: 0.3, y: 0.28 },
  );
  defs += radial(
    'om',
    [
      { offset: 0, color: p.glow, opacity: 1 },
      { offset: 0.6, color: p.ramp[3], opacity: 1 },
      { offset: 1, color: p.ramp[1], opacity: 1 },
    ],
    { x: 0.35, y: 0.3 },
  );

  const ringRx = radius * rng.range(1.7, 2.2);
  const ringRy = ringRx * rng.range(0.18, 0.3);
  const bands = [1, 1.09, 1.2].map((scale, i) => ({
    rx: ringRx * scale,
    ry: ringRy * scale,
    colour: i === 1 ? p.accent : p.glow,
    width: unit * (i === 1 ? 0.011 : 0.004),
    opacity: i === 1 ? 0.5 : 0.7,
  }));
  const ellipse = (band: (typeof bands)[number]) =>
    `<ellipse cx="0" cy="0" rx="${fmt(band.rx)}" ry="${fmt(band.ry)}" fill="none" stroke="${toHex(band.colour)}" stroke-width="${fmt(band.width)}" opacity="${fmt(band.opacity)}"/>`;
  const frontArc = (band: (typeof bands)[number]) =>
    `<path d="M${fmt(-band.rx)} 0 A${fmt(band.rx)} ${fmt(band.ry)} 0 0 0 ${fmt(band.rx)} 0" fill="none" stroke="${toHex(band.colour)}" stroke-width="${fmt(band.width)}" opacity="${fmt(band.opacity)}"/>`;
  const moonAngle = rng.range(0.1, 0.9) * Math.PI;
  const moonX = Math.cos(moonAngle) * ringRx * 1.12;
  const moonY = Math.sin(moonAngle) * ringRy * 1.12;
  const frame = `translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(tilt)})`;

  // The ring passes behind the planet and in front of it, so its two halves are drawn on either side.
  const shapes =
    `<g transform="${frame}">${bands.map(ellipse).join('')}</g>` +
    disc(cx, cy, radius, 'op') +
    disc(cx, cy, radius, 'ot') +
    `<g transform="${frame}">${bands.map(frontArc).join('')}${disc(moonX, moonY, unit * 0.026, 'om')}</g>`;
  return { defs, lights, glow: dusty.glow, shapes };
}

function ribbons(scene: Scene): StyleLayers {
  const { width, height, unit, rng, palette: p } = scene;
  const dusty = dust(scene, height);
  const count = rng.int(16, 26);
  const steps = 90;
  const phase = [rng.range(0, 6.28), rng.range(0, 6.28)] as const;
  const freq = [rng.range(0.6, 1.2), rng.range(1.5, 2.4)] as const;
  const centre = height * rng.range(0.42, 0.58);
  const sweep = [unit * rng.range(0.12, 0.24), unit * rng.range(0.03, 0.08)] as const;
  const fan = unit * rng.range(0.4, 0.7);

  const defs =
    dusty.defs +
    linear('rb', { x: 0, y: 0 }, { x: width, y: 0 }, [
      { offset: 0, color: p.accent, opacity: 1 },
      { offset: 0.5, color: p.glow, opacity: 1 },
      { offset: 1, color: p.ramp[3], opacity: 1 },
    ]);
  let thin = '';
  let wide = '';
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1) - 0.5;
    let d = '';
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      // The lines gather at both ends and open up in the middle, like a twisted ribbon.
      const spread = 0.12 + 0.88 * Math.pow(Math.sin(Math.PI * u), 1.2);
      const y =
        centre +
        sweep[0] * Math.sin(Math.PI * 2 * (u * freq[0] + phase[0])) +
        sweep[1] * Math.sin(Math.PI * 2 * (u * freq[1] + phase[1] + t * 0.5)) +
        t * fan * spread;
      d += `${s === 0 ? 'M' : 'L'}${fmt(u * width)} ${fmt(y)}`;
    }
    const bell = 1 - Math.abs(t) * 1.4;
    thin += `<path d="${d}" fill="none" stroke="url(#rb)" stroke-width="${fmt(unit * 0.0022)}" opacity="${fmt(0.3 + 0.6 * bell)}"/>`;
    if (i % 3 === 0) {
      wide += `<path d="${d}" fill="none" stroke="url(#rb)" stroke-width="${fmt(unit * 0.02)}" opacity="${fmt(0.035 + 0.06 * bell)}"/>`;
    }
  }
  return { defs, lights: dusty.lights, glow: wide + thin + dusty.glow, shapes: '' };
}

const BUILDERS: Record<ArtStyle, (scene: Scene) => StyleLayers> = {
  aurora,
  horizon,
  orbit,
  ribbons,
};

export function buildStyleLayers(style: ArtStyle, scene: Scene): StyleLayers {
  return BUILDERS[style](scene);
}

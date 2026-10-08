import type { MetadataRoute } from 'next';

/** Installable-app metadata. The name is a brand and the tagline lives in `<meta>`, so one file serves both languages. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AIVORE',
    short_name: 'AIVORE',
    description: 'Create stunning images and videos with AI',
    start_url: '/studio',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0b16',
    theme_color: '#0b0b16',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

import type { MetadataRoute } from 'next';

/**
 * Web app manifest for https://sol.changuito.me.
 *
 * Next serves this at /manifest.webmanifest and links it from the document.
 * next.config.ts also rewrites /manifest.json to that URL. Icons are the
 * existing idle mascot on the brand off-white, generated into public/icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Changuito',
    short_name: 'Changuito',
    description: 'Asistente para armar el súper en Argentina y pagar con USDC.',
    lang: 'es',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#FAFAF7',
    theme_color: '#FAFAF7',
    categories: ['shopping'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

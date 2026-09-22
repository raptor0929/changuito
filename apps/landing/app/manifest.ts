import type { MetadataRoute } from 'next';

import { HOME_DESCRIPTION } from '../lib/seo';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Changuito',
    short_name: 'Changuito',
    description: HOME_DESCRIPTION,
    lang: 'es-AR',
    start_url: '/',
    scope: '/',
    display: 'browser',
    background_color: '#fafaf7',
    theme_color: '#fafaf7',
    icons: [
      { src: '/icon.png', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}

import type { Metadata } from 'next';

import { LandingPage } from '../components/landing/landing-page';
import { DESCRIPTION, SITE_URL } from '../lib/copy';

const title = 'Changuito — Pedí el súper inteligente';

export const metadata: Metadata = {
  title: { absolute: title },
  description: DESCRIPTION,
  alternates: { canonical: SITE_URL },
  openGraph: {
    title,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: 'Changuito',
    locale: 'es_AR',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1280,
        height: 720,
        alt: 'Mascota de Changuito, un carrito sonriente con el súper',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description: DESCRIPTION,
    images: ['/og.png'],
  },
};

export default function Home() {
  return <LandingPage />;
}

import type { Metadata } from 'next';

import { LandingPage } from '../components/landing/landing-page';

const title = 'Changuito — Pedí el súper inteligente';
const description =
  'Changuito compara productos, arma el carrito y te deja listo para pagar. Pagá con tarjeta o USDC.';

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: 'https://www.changuito.me' },
  openGraph: {
    title,
    description,
    url: 'https://www.changuito.me',
    siteName: 'Changuito',
    locale: 'es_AR',
    type: 'website',
    images: [
      {
        url: '/brand/mascot-idle.png',
        width: 1280,
        height: 720,
        alt: 'Changuito, un carrito con pan, verdes y un mate',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/brand/mascot-idle.png'],
  },
};

export default function Home() {
  return <LandingPage />;
}

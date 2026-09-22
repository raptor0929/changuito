import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

const description =
  'Changuito compara productos, arma el carrito y te deja listo para pagar. Pagá con tarjeta o USDC.';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.changuito.me'),
  title: {
    default: 'Changuito — Pedí el súper inteligente',
    template: '%s · Changuito',
  },
  description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}

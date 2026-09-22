import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { DESCRIPTION, SITE_URL } from '../lib/copy';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Changuito — Pedí el súper inteligente',
    template: '%s · Changuito',
  },
  description: DESCRIPTION,
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={inter.variable}>
      <body className={inter.className}>{children}</body>
    </html>
  );
}

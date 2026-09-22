import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'Changuito: tu súper, sin pensarlo tanto',
    template: '%s · Changuito',
  },
  description:
    'Asistente de IA para hacer el súper en Argentina. Pedí lo que necesitás, compará precios, armá el carrito y pagá con tarjeta o USDC.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={inter.variable}>
      <body className={inter.className}>{children}</body>
    </html>
  );
}

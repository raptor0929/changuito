import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'changuito',
  description:
    'An agent that shops Argentine supermarkets and settles the basket in USDC on Stellar.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

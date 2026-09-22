import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { SITE_URL } from '../lib/copy';
import {
  HOME_DESCRIPTION,
  INDEXABLE_ROBOTS,
  OG_IMAGE,
  TITLE_SUFFIX,
  documentTitle,
  publicPage,
} from '../lib/seo';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

const home = publicPage('/');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: documentTitle(home.title),
    template: `%s${TITLE_SUFFIX}`,
  },
  description: HOME_DESCRIPTION,
  applicationName: 'Changuito',
  authors: [{ name: 'Changuito' }],
  creator: 'Changuito',
  publisher: 'Changuito',
  robots: INDEXABLE_ROBOTS,
  openGraph: {
    siteName: 'Changuito',
    locale: 'es_AR',
    type: 'website',
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@appchanguito',
    images: [OG_IMAGE.url],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={inter.variable}>
      <body className={inter.className}>{children}</body>
    </html>
  );
}

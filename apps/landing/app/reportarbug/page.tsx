import type { Metadata } from 'next';
import Image from 'next/image';

import { BugReportForm, BugReportSuccess } from '../../components/bug-report/bug-report-form';
import styles from '../../components/bug-report/bug-report.module.css';
import { SITE_URL } from '../../lib/copy';

const title = 'Reportar un bug';
const description = 'Contanos qué pasó. Si algo no anduvo, lo miramos.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/reportarbug` },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/reportarbug`,
    siteName: 'Changuito',
    locale: 'es_AR',
    type: 'website',
  },
};

export default async function ReportarBugPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const listed = estado === 'listo';

  return (
    <div className={styles.page} data-testid="bug-report-screen">
      <a className={styles.skip} href="#reporte">
        Saltar al formulario
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brandLink} href="/" data-testid="bug-report-brand">
            <Image
              src="/brand/isotipo-mascota.png"
              alt=""
              width={337}
              height={467}
              priority
              className={styles.mark}
            />
            <span className={styles.brandName}>Changuito</span>
          </a>
        </div>
      </header>
      <main id="reporte" className={styles.main} data-testid="bug-report-page">
        <Image
          src="/brand/mascot-error.png"
          alt="Changuito con los ojos en X, como si algo hubiera fallado"
          width={397}
          height={583}
          priority
          className={styles.mascot}
          data-testid="bug-report-mascot"
        />
        <h1 className={styles.title}>Contanos qué pasó</h1>
        <p className={styles.lead}>Si algo no anduvo, dejalo acá.</p>
        <div className={styles.card}>
          {listed ? (
            <BugReportSuccess autoFocus />
          ) : (
            <BugReportForm notice={estado === 'error' ? 'Revisá los datos e intentá de nuevo.' : undefined} />
          )}
        </div>
      </main>
      <footer className={styles.footer}>
        <a className={styles.footerLink} href="/">
          Volver al inicio
        </a>
      </footer>
    </div>
  );
}

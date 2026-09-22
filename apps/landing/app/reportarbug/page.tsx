import type { Metadata } from 'next';
import Image from 'next/image';

import { BugReportForm, BugReportSuccess } from '../../components/bug-report/bug-report-form';
import { JsonLd } from '../../components/seo/json-ld';
import styles from '../../components/bug-report/bug-report.module.css';
import { pageMetadata, publicPage, subpageJsonLd } from '../../lib/seo';

const page = publicPage('/reportarbug');

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}): Promise<Metadata> {
  const { estado } = await searchParams;
  return pageMetadata(page, { noindex: Boolean(estado) });
}

export default async function ReportarBugPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const listed = estado === 'listo';

  return (
    <div className={styles.page} data-testid="bug-report-screen">
      <JsonLd data={subpageJsonLd(page)} />
      <a className={styles.skip} href="#reporte">
        Saltar al formulario
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brandLink} href="/" data-testid="bug-report-brand">
            <Image
              src="/brand/mascot-error.png"
              alt=""
              width={397}
              height={583}
              priority
              className={styles.mark}
              data-testid="bug-report-mascot"
            />
            <Image
              src="/brand/wordmark.png"
              alt="Changuito"
              width={1097}
              height={249}
              priority
              className={styles.wordmark}
              data-testid="bug-report-wordmark"
            />
            <span className={styles.srOnly}>volver al inicio</span>
          </a>
        </div>
      </header>
      <main id="reporte" className={styles.main} data-testid="bug-report-page">
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
    </div>
  );
}

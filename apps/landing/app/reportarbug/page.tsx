import type { Metadata, Viewport } from 'next';
import Image from 'next/image';

import { FounderTrust } from '@changuito/trust/ui';
import { AnalyticsView } from '../../components/analytics/analytics-view';
import { BugReportPanel } from '../../components/bug-report/bug-report-panel';
import { BugReportViewport } from '../../components/bug-report/bug-report-viewport';
import { JsonLd } from '../../components/seo/json-ld';
import styles from '../../components/bug-report/bug-report.module.css';
import { pageMetadata, publicPage, subpageJsonLd } from '../../lib/seo';

const page = publicPage('/reportarbug');

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Chrome shrinks the layout viewport with the keyboard. iOS Safari
  // ignores this; the form scrolls the focused field itself.
  interactiveWidget: 'resizes-content',
};

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
      <AnalyticsView event="bug_report_view" />
      {listed ? <AnalyticsView event="bug_report_success" /> : null}
      <BugReportViewport />
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
      <BugReportPanel
        initialDone={listed}
        notice={estado === 'error' ? 'Revisá los datos e intentá de nuevo.' : undefined}
      />
      {/* Outside the form. Hidden while the keyboard is open so it does not
          take a row from the visible band. */}
      <footer className={styles.trust}>
        <FounderTrust />
      </footer>
    </div>
  );
}

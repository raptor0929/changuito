'use client';

import { useEffect, useRef, useState } from 'react';

import { BugReportForm, BugReportSuccess } from './bug-report-form';
import styles from './bug-report.module.css';

/**
 * Form intro and confirmation are different screens.
 * The heading stays off the success view, and "Reportar otro error" brings the form back.
 */
export function BugReportPanel({ initialDone, notice }: { initialDone: boolean; notice?: string }) {
  const [done, setDone] = useState(initialDone);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (done) titleRef.current?.focus();
  }, [done]);

  function showForm() {
    setDone(false);
    const url = new URL(window.location.href);
    if (!url.searchParams.has('estado')) return;
    url.searchParams.delete('estado');
    const next = `${url.pathname}${url.search}`;
    window.history.replaceState(null, '', next);
  }

  if (done) {
    return (
      <main id="reporte" className={styles.confirm} data-testid="bug-report-page">
        <div className={styles.card}>
          <BugReportSuccess titleRef={titleRef} onAgain={showForm} />
        </div>
      </main>
    );
  }

  return (
    <main id="reporte" className={styles.main} data-testid="bug-report-page">
      <h1 className={styles.title}>Contanos qué pasó</h1>
      <p className={styles.lead}>Si algo no anduvo, dejalo acá.</p>
      <div className={styles.card}>
        <BugReportForm notice={notice} onSuccess={() => setDone(true)} />
      </div>
    </main>
  );
}

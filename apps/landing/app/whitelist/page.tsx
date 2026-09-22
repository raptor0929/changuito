import type { Metadata } from 'next';
import Image from 'next/image';

import { WaitlistForm } from '../../components/waitlist/waitlist-form';
import styles from '../../components/waitlist/waitlist.module.css';
import { SITE_URL } from '../../lib/copy';

const title = 'Sumate a la lista';
const description = 'Te avisamos cuando puedas probar Changuito.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/whitelist` },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/whitelist`,
    siteName: 'Changuito',
    locale: 'es_AR',
    type: 'website',
  },
};

export default async function WhitelistPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const listed = estado === 'listo';

  return (
    <div className={styles.page} data-testid="whitelist-screen">
      <a className={styles.skip} href="#lista">
        Saltar al formulario
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brandLink} href="/" data-testid="whitelist-brand">
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
      <main id="lista" className={styles.main} data-testid="whitelist-page">
        <h1 className={styles.title}>Sumate a la lista</h1>
        <p className={styles.lead}>Te avisamos cuando puedas probar Changuito.</p>
        <div className={styles.card}>
          {listed ? (
            <div className={styles.success} data-testid="whitelist-success">
              <h2 className={styles.successTitle} tabIndex={-1}>
                Listo, te anotamos
              </h2>
              <p className={styles.successLead}>Te avisamos por mail cuando puedas probar Changuito.</p>
            </div>
          ) : (
            <WaitlistForm notice={estado === 'error' ? 'Revisá los datos e intentá de nuevo.' : undefined} />
          )}
        </div>
      </main>
    </div>
  );
}

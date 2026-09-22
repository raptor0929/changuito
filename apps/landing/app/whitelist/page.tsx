import type { Metadata } from 'next';
import Image from 'next/image';

import { JsonLd } from '../../components/seo/json-ld';
import { WaitlistForm } from '../../components/waitlist/waitlist-form';
import styles from '../../components/waitlist/waitlist.module.css';
import { pageMetadata, publicPage, subpageJsonLd } from '../../lib/seo';

const page = publicPage('/whitelist');

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}): Promise<Metadata> {
  const { estado } = await searchParams;
  return pageMetadata(page, { noindex: Boolean(estado) });
}

export default async function WhitelistPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const listed = estado === 'listo';

  return (
    <div className={styles.page} data-testid="whitelist-screen">
      <JsonLd data={subpageJsonLd(page)} />
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
        <h1 className={styles.title}>Súmate a la lista para beta testear.</h1>
        <p className={styles.availability} data-testid="whitelist-availability">
          Solo disponible en 🇦🇷
        </p>
        <p className={styles.lead}>Te bonificaremos algo de tu compra del mercado a cambio del feedback.</p>
        <div className={styles.card}>
          {listed ? (
            <div className={styles.success} data-testid="whitelist-success">
              <h2 className={styles.successTitle} tabIndex={-1}>
                Listo, te anotamos
              </h2>
              <p className={styles.successLead}>Te escribimos por WhatsApp cuando puedas probar Changuito.</p>
            </div>
          ) : (
            <WaitlistForm notice={estado === 'error' ? 'Revisá los datos e intentá de nuevo.' : undefined} />
          )}
        </div>
      </main>
    </div>
  );
}

import Image from 'next/image';

import {
  APP_URL,
  BENEFITS,
  BENEFITS_TITLE,
  BOFU,
  FINE_PRINT,
  HERO,
  PAYMENTS,
  STEPS,
  STEPS_TITLE,
} from '../../lib/landing';
import { FaqList } from './faq-list';
import { HeroMascot } from './hero-mascot';
import { CheckIcon, StepIcon } from './icons';
import { SiteHeader } from './site-header';
import { TryLink } from './try-link';

import styles from './landing.module.css';

export function LandingPage() {
  return (
    <div className={styles.page} data-testid="landing">
      <a className={styles.skip} href="#contenido">
        Saltar al contenido
      </a>
      <SiteHeader />
      <main id="contenido">
        <section className={styles.hero} aria-labelledby="hero-title" data-testid="landing-hero">
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <h1 id="hero-title" className={styles.h1}>
                {HERO.h1Lead}
                <br />
                {HERO.h1Rest}
              </h1>
              <p className={styles.sub}>{HERO.sub}</p>
              <p className={styles.payLine}>{HERO.pay}</p>
              <div className={styles.heroActions}>
                <TryLink testId="landing-cta-hero" />
                <a className={styles.textLink} href="#como-funciona">
                  {HERO.secondary}
                </a>
              </div>
            </div>
            <HeroMascot />
          </div>
        </section>

        <section
          id="como-funciona"
          className={`${styles.section} ${styles.anchor}`}
          aria-labelledby="pasos-titulo"
          data-testid="landing-steps"
        >
          <div className={styles.sectionInner}>
            <h2 id="pasos-titulo" className={styles.h2}>
              {STEPS_TITLE}
            </h2>
            <ol className={styles.steps}>
              {STEPS.map((step, index) => (
                <li key={step.title} className={styles.card}>
                  <div className={styles.stepHead}>
                    <span className={styles.stepNo} aria-hidden="true">
                      {index + 1}
                    </span>
                    <StepIcon name={step.icon} className={styles.stepIcon} />
                  </div>
                  <h3 className={styles.cardTitle}>{step.title}</h3>
                  <p className={styles.cardBody}>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.anchor}`}
          aria-labelledby="beneficios-titulo"
          data-testid="landing-benefits"
        >
          <div className={styles.sectionInner}>
            <h2 id="beneficios-titulo" className={styles.h2}>
              {BENEFITS_TITLE}
            </h2>
            <ul className={styles.benefits}>
              {BENEFITS.map((item) => (
                <li key={item.title} className={styles.card}>
                  <h3 className={styles.cardTitle}>{item.title}</h3>
                  <p className={styles.cardBody}>{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="pagos"
          className={`${styles.section} ${styles.anchor}`}
          aria-labelledby="pagos-titulo"
          data-testid="landing-payments"
        >
          <div className={styles.sectionInner}>
            <div className={styles.payIntro}>
              <img src="/brand/logo/sol-mayo.svg" alt="" width={64} height={64} />
              <div>
                <h2 id="pagos-titulo" className={styles.h2}>
                  {PAYMENTS.title}
                </h2>
                <p className={styles.lead}>{PAYMENTS.lead}</p>
              </div>
            </div>
            <ul className={styles.payGrid}>
              {PAYMENTS.methods.map((method) => (
                <li key={method.title} className={styles.card}>
                  <h3 className={styles.cardTitle}>{method.title}</h3>
                  <p className={styles.cardBody}>{method.body}</p>
                </li>
              ))}
            </ul>
            <p className={styles.callout}>
              <CheckIcon className={styles.calloutIcon} />
              <span>{PAYMENTS.assurance}</span>
            </p>
          </div>
        </section>

        <section
          id="faq"
          className={`${styles.section} ${styles.anchor}`}
          aria-labelledby="faq-titulo"
          data-testid="landing-faq"
        >
          <div className={styles.sectionInner}>
            <h2 id="faq-titulo" className={styles.h2}>
              FAQ
            </h2>
            <FaqList />
          </div>
        </section>

        <section className={styles.bofu} aria-labelledby="cierre-titulo" data-testid="landing-bofu">
          <div className={styles.bofuInner}>
            <Image
              src="/brand/logo/lockup-stacked@2x.png"
              alt="Changuito"
              width={384}
              height={605}
              className={styles.lockup}
            />
            <h2 id="cierre-titulo" className={styles.h2}>
              {BOFU.title}
            </h2>
            <p className={styles.lead}>{BOFU.lead}</p>
            <div className={styles.bofuCta}>
              <TryLink testId="landing-cta-bofu" />
            </div>
          </div>
        </section>
      </main>
      <footer className={styles.footer} data-testid="landing-footer">
        <div className={styles.footerInner}>
          <a className={styles.logoLink} href="/">
            <Image
              src="/brand/logo/wordmark@2x.png"
              alt="Changuito"
              width={1097}
              height={249}
              className={styles.footerMark}
            />
          </a>
          <nav aria-label="Pie" className={styles.footerNavWrap}>
            <ul className={styles.footerNav}>
              <li>
                <a className={styles.footerLink} href="#como-funciona">
                  Cómo funciona
                </a>
              </li>
              <li>
                <a className={styles.footerLink} href="#pagos">
                  Pagos
                </a>
              </li>
              <li>
                <a className={styles.footerLink} href="#faq">
                  Ayuda
                </a>
              </li>
              <li>
                <a className={styles.footerLink} href="/" >
                  www.changuito.me
                </a>
              </li>
              <li>
                <a className={styles.footerLink} href={APP_URL} rel="noopener noreferrer">
                  app.changuito.me
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <p className={styles.fine}>{FINE_PRINT}</p>
        <p className={styles.fine}>© 2026 Changuito</p>
      </footer>
    </div>
  );
}

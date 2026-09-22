import {
  APP_URL,
  BENEFITS,
  BENEFITS_TITLE,
  BOFU,
  FAQ_TITLE,
  FOOTER,
  HERO,
  NAV,
  PAYMENTS,
  STEPS,
  STEPS_TITLE,
} from '../../lib/copy';
import { BrandLockup } from './brand-lockup';
import { FaqList } from './faq-list';
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
                  <span aria-hidden="true"> ↓</span>
                </a>
              </div>
            </div>
            <div className={styles.mascotFrame}>
              {/* GIF plays by default. Reduced motion swaps to the locked still via CSS. */}
              <img
                className={`${styles.mascot} ${styles.mascotMotion}`}
                src="/brand/animacion-busqueda.gif"
                alt="Changuito va y vuelve buscando el súper"
                width={480}
                height={320}
                fetchPriority="high"
              />
              <img
                className={`${styles.mascot} ${styles.mascotStill}`}
                src="/brand/mascot-idle.png"
                alt="Mascota de Changuito, un carrito sonriente con el súper"
                width={397}
                height={583}
              />
            </div>
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
                <li key={item.title} className={`${styles.card} ${styles.benefitCard}`}>
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
            <div className={styles.payLayout}>
              <div>
                <h2 id="pagos-titulo" className={styles.h2}>
                  {PAYMENTS.title}
                </h2>
                <p className={styles.lead}>{PAYMENTS.lead}</p>
                <ul className={styles.payGrid}>
                  {PAYMENTS.methods.map((method) => (
                    <li key={method.title} className={styles.card}>
                      <h3 className={styles.cardTitle}>{method.title}</h3>
                      <p className={styles.cardBody}>{method.body}</p>
                    </li>
                  ))}
                </ul>
                <p className={styles.assurance}>
                  <CheckIcon className={styles.assuranceIcon} />
                  <span>{PAYMENTS.assurance}</span>
                </p>
              </div>
              <div className={styles.payMascotFrame}>
                <img
                  className={`${styles.payMascot} ${styles.mascotMotion}`}
                  src="/brand/animacion-busqueda.gif"
                  alt="Changuito va y vuelve buscando el súper"
                  width={480}
                  height={320}
                />
                <img
                  className={`${styles.payMascot} ${styles.mascotStill}`}
                  src="/brand/mascot-idle.png"
                  alt="Mascota de Changuito, un carrito sonriente con el súper"
                  width={397}
                  height={583}
                />
              </div>
            </div>
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
              {FAQ_TITLE}
            </h2>
            <FaqList />
          </div>
        </section>

        <section className={styles.bofu} aria-labelledby="cierre-titulo" data-testid="landing-bofu">
          <div className={styles.bofuInner}>
            <BrandLockup className={styles.bofuBrand} />
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
            <BrandLockup className={styles.footerBrand} />
          </a>
          <nav aria-label="Pie" className={styles.footerNavWrap}>
            <ul className={styles.footerNav}>
              {NAV.map((link) => (
                <li key={link.href}>
                  <a className={styles.footerLink} href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
              <li>
                <a className={styles.footerLink} href="/">
                  {FOOTER.siteLabel}
                </a>
              </li>
              <li>
                <a className={styles.footerLink} href={APP_URL} rel="noopener noreferrer">
                  {FOOTER.appLabel}
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <p className={styles.fine}>{FOOTER.legal}</p>
        <p className={styles.fine}>{FOOTER.copyright}</p>
      </footer>
    </div>
  );
}

import {
  BOFU,
  COMPARE,
  FAQ_TITLE,
  FOOTER,
  HERO,
  NAV,
  PAYMENTS,
  SOCIAL,
  STEPS,
  STEPS_TITLE,
  USES,
  USES_TITLE,
} from '../../lib/copy';
import { FounderTrust } from '@changuito/trust/ui';
import { BrandLockup } from './brand-lockup';
import { FaqList } from './faq-list';
import { HeroDemo } from './hero-demo';
import { CheckIcon, InstagramIcon, StepIcon } from './icons';
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
              <div className={styles.heroActions}>
                <TryLink testId="landing-cta-hero" />
              </div>
            </div>
            <HeroDemo />
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
          id="ahorro"
          className={`${styles.section} ${styles.anchor}`}
          aria-labelledby="ahorro-titulo"
          data-testid="landing-compare"
        >
          <div className={styles.sectionInner}>
            <h2 id="ahorro-titulo" className={styles.h2}>
              {COMPARE.title}
            </h2>
            <div className={styles.compareLayout}>
              <p className={styles.fact}>{COMPARE.body}</p>
              <div className={styles.compareCard} aria-hidden="true">
                <p className={styles.compareLabel}>Mismo producto</p>
                <div className={styles.compareRow}>
                  <span className={styles.compareChain}>Cadena A</span>
                  <span className={styles.barTrack}>
                    <span className={styles.barShort} />
                  </span>
                </div>
                <div className={styles.compareRow}>
                  <span className={styles.compareChain}>Cadena B</span>
                  <span className={styles.barTrack}>
                    <span className={styles.barLong} />
                  </span>
                  <span className={styles.savePill}>+40%</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="ocasiones"
          className={`${styles.section} ${styles.anchor}`}
          aria-labelledby="usos-titulo"
          data-testid="landing-uses"
        >
          <div className={styles.sectionInner}>
            <h2 id="usos-titulo" className={styles.h2}>
              {USES_TITLE}
            </h2>
            <ul className={styles.uses}>
              {USES.map((item) => (
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
            <h2 id="pagos-titulo" className={styles.h2}>
              {PAYMENTS.title}
            </h2>
            <p className={styles.assurance}>
              <CheckIcon className={styles.assuranceIcon} />
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
              <TryLink testId="landing-cta-bofu" label={BOFU.cta} />
            </div>
          </div>
        </section>
      </main>
      <footer className={styles.footer} data-testid="landing-footer">
        <div className={styles.footerInner}>
          <a className={styles.logoLink} href="/">
            <BrandLockup className={styles.footerBrand} />
          </a>
          <div className={styles.footerMeta}>
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
                  <a className={styles.footerLink} href="/reportarbug" data-testid="landing-report-bug">
                    Reportar un bug
                  </a>
                </li>
                <li>
                  <a className={styles.footerLink} href="/">
                    {FOOTER.siteLabel}
                  </a>
                </li>
              </ul>
            </nav>
            <ul className={styles.footerSocial} data-testid="landing-social">
              {SOCIAL.map((link) => {
                // The X glyph sits before the label "X" and reads as a second link.
                const showInstagram = link.icon === 'instagram';
                return (
                  <li key={link.href}>
                    <a
                      className={
                        showInstagram ? styles.socialLink : `${styles.socialLink} ${styles.socialText}`
                      }
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={link.ariaLabel}
                    >
                      {showInstagram ? <InstagramIcon className={styles.socialIcon} /> : null}
                      <span>{link.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <p className={styles.fine}>{FOOTER.legal}</p>
        <FounderTrust className={styles.fine} />
      </footer>
    </div>
  );
}

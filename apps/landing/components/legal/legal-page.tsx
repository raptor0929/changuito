import type { Metadata } from 'next';
import { Fragment, type ReactNode } from 'react';

import { FounderTrust } from '@changuito/trust/ui';

import { canonicalUrl, INDEXABLE_ROBOTS, OG_IMAGE } from '../../lib/seo';
import { LEGAL_PATHS, SUPPORT_EMAIL, legalCopy, type LegalDoc, type LegalLang } from '../../lib/legal';

import styles from './legal.module.css';

export function legalMetadata(doc: LegalDoc, lang: LegalLang): Metadata {
  const copy = legalCopy(doc, lang);
  const url = canonicalUrl(copy.path);
  return {
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical: url,
      languages: {
        'es-AR': canonicalUrl(LEGAL_PATHS[doc].es),
        en: canonicalUrl(LEGAL_PATHS[doc].en),
        'x-default': canonicalUrl(LEGAL_PATHS[doc].en),
      },
    },
    robots: INDEXABLE_ROBOTS,
    openGraph: {
      title: copy.title,
      description: copy.description,
      url,
      siteName: 'Changuito',
      locale: lang === 'es' ? 'es_AR' : 'en_US',
      type: 'website',
      images: [OG_IMAGE],
    },
  };
}

/** Turns the support address into a mailto link wherever the copy names it. */
function withSupportLink(text: string): ReactNode {
  if (!text.includes(SUPPORT_EMAIL)) return text;
  const parts = text.split(SUPPORT_EMAIL);
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 ? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> : null}
    </Fragment>
  ));
}

/** Terms or privacy, in one language. Server-rendered static text, no client JS. */
export function LegalPage({ doc, lang }: { doc: LegalDoc; lang: LegalLang }) {
  const copy = legalCopy(doc, lang);
  const date = new Intl.DateTimeFormat(lang === 'es' ? 'es-AR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${copy.updated}T12:00:00Z`));

  return (
    <div className={styles.page} lang={lang === 'es' ? 'es-AR' : 'en'} data-testid={`legal-${doc}-${lang}`} data-legal="">
      <a className={styles.skip} href="#contenido">
        {copy.skipLabel}
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="/">
            Changuito<span className={styles.srOnly}> · {copy.backLabel}</span>
          </a>
          <a
            className={styles.switch}
            href={copy.switchHref}
            hrefLang={copy.switchLang === 'es' ? 'es-AR' : 'en'}
            lang={copy.switchLang === 'es' ? 'es-AR' : 'en'}
            data-testid="legal-lang-switch"
          >
            {copy.switchLabel}
          </a>
        </div>
      </header>
      <main id="contenido" className={styles.main} tabIndex={-1}>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.updated}>
          {copy.updatedLabel}: <time dateTime={copy.updated}>{date}</time>
        </p>
        <p className={styles.intro}>{copy.intro}</p>
        <nav aria-label={copy.contentsLabel} className={styles.toc}>
          <h2 className={styles.tocTitle}>{copy.contentsLabel}</h2>
          <ol className={styles.tocList}>
            {copy.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.heading}</a>
              </li>
            ))}
          </ol>
        </nav>
        {copy.sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-h`} className={styles.section}>
            <h2 id={`${section.id}-h`} className={styles.heading}>
              {section.heading}
            </h2>
            {section.paragraphs.map((text) => (
              <p key={text}>{withSupportLink(text)}</p>
            ))}
          </section>
        ))}
      </main>
      <footer className={styles.footer}>
        <a href="/">{copy.backLabel}</a>
        {(['terms', 'privacy', 'deletion'] as const)
          .filter((item) => item !== doc)
          .map((item) => (
            <a key={item} href={LEGAL_PATHS[item][lang]}>
              {legalCopy(item, lang).title}
            </a>
          ))}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        <FounderTrust className={styles.fine} />
      </footer>
    </div>
  );
}

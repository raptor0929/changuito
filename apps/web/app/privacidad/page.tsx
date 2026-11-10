import type { Metadata } from 'next';

import { LangToggle } from '../../components/LangToggle';
import { LangProvider } from '../../components/LangProvider';
import { ScrollPage } from '../../components/ScrollPage';
import { PUBLIC_LEGAL, SUPPORT_EMAIL } from '@changuito/trust';
import { inLang } from '../../lib/lang.ts';
import { langFromCookie } from '../../lib/lang-server.ts';
import { privacyCopy } from '../../lib/privacy-copy.ts';
import { socialLinks } from '../../lib/social.ts';

export const dynamic = 'force-dynamic';

const BUG = 'https://www.changuito.me/reportarbug';

const LINKEDIN = {
  href: 'https://www.linkedin.com/company/appchanguito/',
  es: 'Changuito en LinkedIn',
  en: 'Changuito on LinkedIn',
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const lang = await langFromCookie();
  return {
    title: inLang(lang, { es: 'Privacidad', en: 'Privacy' }),
    description: inLang(lang, {
      es: 'Qué datos guarda esta aplicación y qué no puede borrar.',
      en: 'What this app stores, and what it cannot delete.',
    }),
  };
}

export default async function PrivacyPage() {
  const lang = await langFromCookie();
  const copy = privacyCopy(lang);
  const profiles = [
    ...socialLinks(lang).map((link) => ({ href: link.href, label: link.ariaLabel })),
    { href: LINKEDIN.href, label: inLang(lang, { es: LINKEDIN.es, en: LINKEDIN.en }) },
  ];
  return (
    <LangProvider initial={lang}>
      <ScrollPage>
        <p className="legal-back">
          <a href="/">{copy.back}</a>
        </p>
        <h1>{copy.title}</h1>
        <p className="legal-intro">{copy.intro}</p>
        {copy.sections.map((section) => (
          <section key={section.id} aria-labelledby={`privacy-${section.id}`}>
            <h2 id={`privacy-${section.id}`}>{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
        <section aria-labelledby="privacy-contact">
          <h2 id="privacy-contact">{copy.contactHeading}</h2>
          <p>{copy.contactLead}</p>
          <ul className="legal-contact">
            <li>
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </li>
            <li>
              <a href={inLang(lang, PUBLIC_LEGAL.privacy)}>{inLang(lang, { es: 'Política publicada', en: 'Published policy' })}</a>
            </li>
            <li>
              <a href={inLang(lang, PUBLIC_LEGAL.deletion)}>{inLang(lang, { es: 'Eliminar la cuenta', en: 'Delete the account' })}</a>
            </li>
            {profiles.map((link) => (
              <li key={link.href}>
                <a href={link.href} target="_blank" rel="noopener noreferrer">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
        <footer className="legal-footer">
          <LangToggle />
        </footer>
      </ScrollPage>
    </LangProvider>
  );
}

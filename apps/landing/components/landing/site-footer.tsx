import { FounderTrust } from '@changuito/trust/ui';

import { FOOTER, NAV, SOCIAL } from '../../lib/copy';
import { DELETION_FOOTER_LINKS, LEGAL_FOOTER_LINKS, SUPPORT_FOOTER_LINK } from '../../lib/legal';
import { BrandLockup } from './brand-lockup';
import { InstagramIcon, LinkedInIcon, XIcon } from './icons';
import { PoweredBy } from './powered-by';

import styles from './landing.module.css';

/**
 * Site footer shared by the home and /whitelist.
 * navBase prefixes the in-page anchors so they resolve to the home from
 * other routes. trust=false skips the founder line on pages that already
 * show it above the fold.
 */
const SOCIAL_ICONS = {
  instagram: InstagramIcon,
  linkedin: LinkedInIcon,
  x: XIcon,
} as const;

export function SiteFooter({ navBase = '', trust = true }: { navBase?: string; trust?: boolean }) {
  return (
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
                  <a className={styles.footerLink} href={`${navBase}${link.href}`}>
                    {link.label}
                  </a>
                </li>
              ))}
              <li>
                <a className={styles.footerLink} href="/reportarbug" data-testid="landing-report-bug">
                  Reportar un bug
                </a>
              </li>
              {LEGAL_FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <a className={styles.footerLink} href={link.href} data-testid={link.testId}>
                    {link.label}
                  </a>
                </li>
              ))}
              {DELETION_FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <a className={styles.footerLink} href={link.href} data-testid={link.testId}>
                    {link.label}
                  </a>
                </li>
              ))}
              <li>
                <a className={styles.footerLink} href={SUPPORT_FOOTER_LINK.href} data-testid={SUPPORT_FOOTER_LINK.testId}>
                  {SUPPORT_FOOTER_LINK.label}
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
              const Icon = SOCIAL_ICONS[link.icon];
              return (
                <li key={link.href}>
                  <a
                    className={styles.socialLink}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={link.ariaLabel}
                    data-testid={`landing-social-${link.icon}`}
                  >
                    <Icon className={styles.socialIcon} />
                    <span>{link.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <PoweredBy />
      <p className={styles.fine}>{FOOTER.legal}</p>
      {trust ? <FounderTrust className={styles.fine} /> : null}
    </footer>
  );
}

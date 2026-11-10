import { NEW_TAB_HINT } from '@changuito/trust';

import styles from './landing.module.css';

/**
 * The three marks under "Powered by".
 *
 * Grey wordmarks are the mono assets (AcademiaQA, BAF). Superteam Argentina
 * stays in color: it is a badge, and greying it drops the mark. Heights are
 * set in CSS (16px, 18px from 768px). The files are larger so a 2x screen
 * does not soften them.
 *
 * Each control is a link whose name is the organization. The picture is
 * decorative (`alt=""`) so the name is not spoken twice. The new-tab hint
 * matches the founder links.
 */
const PARTNERS = [
  {
    id: 'academiaqa',
    name: 'AcademiaQA',
    href: 'https://academiaqa.com',
    src: '/brand/partners/academiaqa-mono.png',
    width: 416,
    height: 96,
    color: false,
  },
  {
    id: 'superteam',
    name: 'Superteam Argentina',
    href: 'https://superteam.fun/earn/regions/argentina/',
    src: '/brand/partners/superteam-ar-color.png',
    width: 96,
    height: 96,
    color: true,
  },
  {
    id: 'baf',
    name: 'BAF Network',
    href: 'https://blockchainacceleration.org',
    src: '/brand/partners/baf-mono.svg',
    width: 85,
    height: 26,
    color: false,
  },
] as const;

export function PoweredBy() {
  return (
    <div className={styles.poweredBy} role="group" aria-label="Powered by" data-testid="powered-by">
      <span className={styles.poweredByLabel}>Powered by</span>
      <ul className={styles.poweredByList}>
        {PARTNERS.map((partner) => (
          <li key={partner.id}>
            <a
              className={styles.poweredByLink}
              href={partner.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${partner.name} (${NEW_TAB_HINT})`}
              data-testid={`powered-by-${partner.id}`}
            >
              <img
                className={partner.color ? `${styles.poweredByLogo} ${styles.poweredByLogoColor}` : styles.poweredByLogo}
                src={partner.src}
                alt=""
                width={partner.width}
                height={partner.height}
                decoding="async"
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { NEW_TAB_HINT } from '../lib/founder-trust-copy';
import { SOCIAL } from '../lib/social';
import { InstagramIcon, XIcon } from './icons';

const ICONS = {
  instagram: InstagramIcon,
  x: XIcon,
} as const;

/**
 * Icon links for the public profiles. They sit beside the trust line, not
 * inside it, so the founder sentence stays one reading and the LinkedIn
 * names stay the only text links in that sentence.
 *
 * The accessible name starts with the same label the landing uses. The
 * new-tab hint is the same phrase the founder links append.
 */
export function FooterSocial() {
  return (
    <nav className="app-social" aria-label="Redes de Changuito" data-testid="app-social">
      <ul className="app-social-list">
        {SOCIAL.map((link) => {
          const Icon = ICONS[link.id];
          return (
            <li key={link.id}>
              <a
                className="app-social-link"
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${link.ariaLabel} (${NEW_TAB_HINT})`}
                data-testid={`app-social-${link.id}`}
              >
                <Icon />
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
